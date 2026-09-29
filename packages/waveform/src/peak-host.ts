/**
 * Sharing peaks among views: one job per source identity and revision, one
 * worker for every job, and the kept cache in between.
 *
 * A view opens a handle and releases it when it goes; the job lives while any
 * handle to it does, not as long as a component (ADR-0043, the packet's rule
 * that the cache depends on media identity and revision). The worker is made
 * with the first job and is the only one, so one pyramid is built at a time
 * (G4). Its messages are read field by field and handed to the job they name;
 * one it cannot read, or the worker failing, fails every job with the reason,
 * never silently.
 */

import { describedBuffers, type CancellationSignal } from '@audiogubbins/audio-engine';

import type { SampleWindow } from './peak-columns.js';
import { PeakJob, type PeakEvent, type PeakStatus } from './peak-job.js';
import { ToPeakWorkerKind, type FrameRange, type ToPeakWorker } from './peak-messages.js';
import { readFromPeakWorker } from './peak-message-reading.js';
import type { WaveformPeakPyramid } from './peak-pyramid.js';
import type { PeakSubject } from './peak-subject.js';
import type { ZeroCrossingSearch } from './zero-crossings.js';

/** The page's end of the peak worker. */
export interface PeakWorkerPort {
  post(message: ToPeakWorker, transfer: readonly ArrayBuffer[]): void;
  /** Listens for the worker's messages, and for its failing, with the reason. */
  listen(onMessage: (value: unknown) => void, onFault: (reason: string) => void): void;
  terminate(): void;
}

/** Where finished pyramids are kept between sessions: a disposable cache. */
export interface PeakCacheStore {
  read(identity: string, revision: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  write(identity: string, revision: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}

/** A view's hold on a source's peaks. */
export interface PeakHandle {
  /** The pyramid as it stands; replaced whole when a kept cache is adopted. */
  readonly pyramid: WaveformPeakPyramid;
  readonly status: PeakStatus;
  subscribe(listener: () => void): () => void;
  focus(range: FrameRange): void;
  samples(range: FrameRange, signal?: CancellationSignal): Promise<SampleWindow>;
  readonly zeroCrossings: ZeroCrossingSearch;
  /** Lets go; the job closes when the last handle to it does. */
  release(): void;
}

interface Shared {
  readonly job: PeakJob;
  holders: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The buffers an opening job sends, transferred: the audio's arrays, and the kept cache's bytes. */
function transfersOf(message: ToPeakWorker): readonly ArrayBuffer[] {
  if (message.kind !== ToPeakWorkerKind.Open) return [];
  const described = describedBuffers([message.description]);
  return message.cached === undefined ? described : [...described, message.cached.buffer];
}

/** Shares peaks among views. */
export class PeakHost {
  readonly #createWorker: () => PeakWorkerPort;
  readonly #cache: PeakCacheStore;
  readonly #report: (event: PeakEvent) => void;
  readonly #shared = new Map<string, Shared>();
  readonly #byName = new Map<string, PeakJob>();
  #worker: PeakWorkerPort | undefined;
  #jobs = 0;

  constructor(options: {
    readonly createWorker: () => PeakWorkerPort;
    readonly cache: PeakCacheStore;
    readonly report: (event: PeakEvent) => void;
  }) {
    this.#createWorker = options.createWorker;
    this.#cache = options.cache;
    this.#report = options.report;
  }

  /** A handle on `subject`'s peaks, shared with every other view of the same source and revision. */
  open(subject: PeakSubject): PeakHandle {
    const key = `${subject.identity}\u0000${subject.revision}`;
    const shared = this.#shared.get(key) ?? this.#start(key, subject);
    shared.holders += 1;
    let released = false;
    const job = shared.job;
    return {
      get pyramid() {
        return job.pyramid;
      },
      get status() {
        return job.status;
      },
      subscribe: (listener) => job.subscribe(listener),
      focus: (range) => {
        job.focus(range);
      },
      samples: (range, signal) => job.samples(range, signal),
      zeroCrossings: {
        nearest: (position, within, channels, signal) =>
          job.nearestZeroCrossing(position, within, channels, signal),
      },
      release: () => {
        if (released) return;
        released = true;
        shared.holders -= 1;
        if (shared.holders === 0) this.#close(key, shared.job);
      },
    };
  }

  #start(key: string, subject: PeakSubject): Shared {
    this.#jobs += 1;
    const name = `peaks-${String(this.#jobs)}`;
    const job = new PeakJob({
      name,
      subject,
      post: (message) => {
        this.#workerPort().post(message, transfersOf(message));
      },
      keep: (bytes) => this.#cache.write(subject.identity, subject.revision, bytes),
      report: this.#report,
    });
    const shared: Shared = { job, holders: 0 };
    this.#shared.set(key, shared);
    this.#byName.set(name, job);
    this.#cache
      .read(subject.identity, subject.revision)
      .catch((error: unknown) => {
        this.#report({
          kind: 'cache-unreadable',
          identity: subject.identity,
          reason: messageOf(error),
        });
        return undefined;
      })
      .then((cached) => {
        job.start(cached);
      })
      .catch((error: unknown) => {
        job.fail(`The peaks could not be started: ${messageOf(error)}`);
      });
    return shared;
  }

  #workerPort(): PeakWorkerPort {
    if (this.#worker !== undefined) return this.#worker;
    const worker = this.#createWorker();
    worker.listen(
      (value) => {
        this.#receive(value);
      },
      (reason) => {
        this.#workerFailed(reason);
      },
    );
    this.#worker = worker;
    return worker;
  }

  #receive(value: unknown): void {
    const read = readFromPeakWorker(value);
    if (!read.ok) {
      this.#workerFailed(read.failures[0].summary);
      return;
    }
    this.#byName.get(read.value.job)?.receive(read.value);
  }

  /** The worker failed, or sent what cannot be read: every job fails with the reason, and the next open makes a new worker. */
  #workerFailed(reason: string): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const job of this.#byName.values()) job.fail(`The peak worker stopped: ${reason}`);
  }

  #close(key: string, job: PeakJob): void {
    this.#shared.delete(key);
    for (const [name, each] of this.#byName) if (each === job) this.#byName.delete(name);
    job.close();
  }

  /** Closes every job and the worker. */
  dispose(): void {
    for (const [key, shared] of [...this.#shared]) this.#close(key, shared.job);
    this.#worker?.terminate();
    this.#worker = undefined;
  }
}
