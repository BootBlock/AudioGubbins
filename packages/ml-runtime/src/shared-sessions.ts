/**
 * The inference worker's sessions, shared by model file and options among
 * every thread it serves (ADR-0062).
 *
 * A model's file is read from storage, hashed and loaded into the runtime
 * before a session on it runs, and a pack's file is up to hundreds of
 * megabytes; the preview, render, feeder, peak and detection workers each run
 * the same chains, and a whole pass opens its model again every time it runs.
 * So an open of a file and options a session is already open on shares that
 * session and reads nothing, and an open of one being opened waits for it. A
 * session no thread holds is kept, the most recently let go first, while the
 * files of those kept come to no more than {@link MOST_IDLE_MODEL_BYTES}, so
 * a pass run again soon reads nothing either; the worker lets them all go
 * once no thread is connected to it. A file is known by the SHA-256 its
 * reader held its bytes to, so a session is shared only by opens of the same
 * bytes. Runs on a shared session are taken in turn by the session itself, as
 * every session takes its runs.
 */

import {
  createCancellationSource,
  succeed,
  type CancellationSignal,
  type CancellationSource,
  type DomainResult,
} from '@audiogubbins/domain';

import { optionsKey, type InferenceExecution, type InferenceOptions } from './inference-options.js';
import {
  cancelled,
  released,
  unlessCancelled,
  type InferencePort,
  type InferenceSession,
  type ModelSource,
} from './inference-port.js';
import type { Tensor, TensorInfo } from './tensor.js';

/**
 * The most bytes of model files whose sessions are kept with no thread holding
 * them: 256 MiB, room for the largest pack's file (MossFormer2's 229 MB) so a
 * pass of it run again reads nothing, and not for two large models, whose
 * weights the runtime holds besides, on a device with a few gigabytes.
 */
const MOST_IDLE_MODEL_BYTES = 256 * 2 ** 20;

/** A session opened on a file, and the bytes the file took. */
interface Opened {
  readonly session: InferenceSession;
  readonly bytes: number;
}

/**
 * One file and options: the session's opening, the session once open, and
 * its holders, every open waiting on the opening among them, so a session is
 * never let go under an open about to take it.
 */
interface Entry {
  opening: Promise<DomainResult<void>>;
  opened: Opened | undefined;
  holders: number;
}

/** Whether `signal` has been cancelled, asked afresh each time. */
function aborted(signal: CancellationSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** One thread's hold on a shared session, which it runs and lets go as its own. */
class SharedSession implements InferenceSession {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  readonly execution: InferenceExecution;
  readonly #session: InferenceSession;
  readonly #letGo: () => void;
  /** Cancelled once this hold is let go, which answers its runs in hand as released. */
  readonly #held: CancellationSource = createCancellationSource();

  constructor(session: InferenceSession, letGo: () => void) {
    this.inputs = session.inputs;
    this.outputs = session.outputs;
    this.execution = session.execution;
    this.#session = session;
    this.#letGo = letGo;
  }

  run(
    inputs: ReadonlyMap<string, Tensor>,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>> {
    if (this.#held.signal.aborted) return Promise.resolve(released());
    return unlessCancelled(this.#session.run(inputs, signal), this.#held.signal, {
      answer: released,
    });
  }

  release(): void {
    if (this.#held.signal.aborted) return;
    this.#held.cancel();
    this.#letGo();
  }
}

/** The inference port over another, sharing its sessions (see the module comment). */
export class SharedSessions implements InferencePort {
  readonly #port: InferencePort;
  readonly #mostIdleBytes: number;
  /** By file and options, those let go most recently last. */
  readonly #entries = new Map<string, Entry>();

  constructor(port: InferencePort, mostIdleBytes = MOST_IDLE_MODEL_BYTES) {
    this.#port = port;
    this.#mostIdleBytes = mostIdleBytes;
  }

  async open(
    model: ModelSource,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>> {
    const key = `${model.sha256} ${optionsKey(options)}`;
    // Another open's failure, a read refused or cancelled among them, is not
    // this one's: it opens the file afresh with its own reader.
    for (;;) {
      if (aborted(signal)) return cancelled();
      const joined = this.#entries.get(key);
      const entry = joined ?? this.#begin(key, model, options, signal);
      entry.holders += 1;
      const opening = await unlessCancelled(entry.opening, signal);
      if (!opening.ok) {
        // A wait cancelled gives its hold up; an opening that failed has
        // taken its entry with it.
        this.#letGo(key, entry);
        if (joined === undefined || aborted(signal)) return opening;
        continue;
      }
      const { opened } = entry;
      if (opened === undefined) throw new Error('An opening that succeeded holds its session.');
      return succeed(
        new SharedSession(opened.session, () => {
          this.#letGo(key, entry);
        }),
      );
    }
  }

  /** Lets go of every session no thread holds, as a worker no thread is connected to does. */
  releaseIdle(): void {
    for (const [key, entry] of [...this.#entries]) {
      if (entry.holders === 0 && entry.opened !== undefined) this.#forget(key, entry);
    }
  }

  /** The entry of a file and options opened afresh, through `model`'s reader. */
  #begin(
    key: string,
    model: ModelSource,
    options: InferenceOptions,
    signal: CancellationSignal | undefined,
  ): Entry {
    let bytes = 0;
    const counted: ModelSource = {
      sha256: model.sha256,
      read: async (inner) => {
        const read = await model.read(inner);
        if (read.ok) bytes = read.value.byteLength;
        return read;
      },
    };
    const entry: Entry = {
      opening: Promise.resolve(succeed(undefined)),
      opened: undefined,
      holders: 0,
    };
    entry.opening = this.#port.open(counted, options, signal).then((opened) => {
      if (!opened.ok) {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
        return opened;
      }
      entry.opened = { session: opened.value, bytes };
      // Held by nobody where every open that waited on it was cancelled, so
      // kept as any session let go is.
      this.#trim();
      return succeed(undefined);
    });
    this.#entries.set(key, entry);
    return entry;
  }

  /** One thread lets go of its hold; the last makes the session the most recently let go. */
  #letGo(key: string, entry: Entry): void {
    entry.holders -= 1;
    if (entry.holders > 0 || this.#entries.get(key) !== entry) return;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#trim();
  }

  /** Lets go of sessions nobody holds, the least recently let go first, until the bound is met. */
  #trim(): void {
    const idle = [...this.#entries].filter(
      ([, entry]) => entry.holders === 0 && entry.opened !== undefined,
    );
    let total = idle.reduce((sum, [, entry]) => sum + (entry.opened?.bytes ?? 0), 0);
    for (const [key, entry] of idle) {
      if (total <= this.#mostIdleBytes) return;
      total -= entry.opened?.bytes ?? 0;
      this.#forget(key, entry);
    }
  }

  #forget(key: string, entry: Entry): void {
    this.#entries.delete(key);
    entry.opened?.session.release();
  }
}
