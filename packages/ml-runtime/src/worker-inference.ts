/**
 * The inference port on a thread's side of the inference worker (ADR-0062).
 *
 * The client asks for a connection to the worker on the first session and keeps
 * it for the next; whoever made the client says how a connection is made, and
 * the page starts the worker with the runtime's setup. Each call is a message;
 * each answer is read field by field and settles the call it names. A cancelled
 * call is answered at once and the worker told; a session that opened for a
 * call already answered is let go. An open names the model's file by its
 * SHA-256, and its bytes are read only when the worker asks for them, having no
 * session on that file to share; they are then transferred, not copied, since
 * nothing on this side keeps them, and so are inputs' buffers. A connection
 * that fails, or answers what cannot be read, is ended, and every call and
 * session it held fails with the reason; the next session makes a new one.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  capabilityRefusal,
  type InferenceCapabilities,
  type InferenceOptions,
} from './inference-options.js';
import {
  cancelled,
  released,
  type InferencePort,
  type InferenceSession,
  type ModelBytes,
  type ModelSource,
} from './inference-port.js';
import { readFromInferenceWorker } from './protocol/inference-message-reading.js';
import {
  FromInferenceWorkerKind,
  ToInferenceWorkerKind,
  movable,
  tensorTransfers,
  type FromInferenceWorker,
  type ToInferenceWorker,
} from './protocol/inference-messages.js';
import type { Tensor } from './tensor.js';
import { WorkerSession, type SessionCalls } from './worker-session.js';

/** A thread's end of its connection to an inference worker. */
export interface InferenceWorkerPort {
  post(message: ToInferenceWorker, transfer: readonly ArrayBuffer[]): void;
  /** Listens for the worker's messages, and for its failing, with the reason. */
  listen(onMessage: (value: unknown) => void, onFault: (reason: string) => void): void;
  terminate(): void;
}

/** A call waiting for the worker's answer. */
type Pending =
  | {
      readonly kind: typeof FromInferenceWorkerKind.Opened;
      readonly settle: (result: DomainResult<InferenceSession>) => void;
      /** The model's file, read only if the worker asks for its bytes. */
      readonly model: ModelSource;
      readonly signal: CancellationSignal | undefined;
    }
  | {
      readonly kind: typeof FromInferenceWorkerKind.Ran;
      readonly session: number;
      readonly settle: (result: DomainResult<ReadonlyMap<string, Tensor>>) => void;
    };

function workerFailed(summary: string): DomainFailureResult {
  return fail(failure('inference.worker-failed', FailureKind.Unrecoverable, summary));
}

/** The model's bytes alone in their buffer, so a transfer moves nothing around them. */
function movableModel(model: ModelBytes): ModelBytes {
  return model.byteOffset === 0 && model.byteLength === model.buffer.byteLength
    ? model
    : model.slice();
}

/** One worker and the calls and sessions it holds. */
class Connection implements SessionCalls {
  readonly #worker: InferenceWorkerPort;
  readonly #ended: () => void;
  readonly #pending = new Map<number, Pending>();
  #calls = 0;
  /** Why the worker is gone, once it is. */
  #failure: DomainFailureResult | undefined;

  constructor(worker: InferenceWorkerPort, ended: () => void) {
    this.#worker = worker;
    this.#ended = ended;
    worker.listen(
      (value) => {
        this.#receive(value);
      },
      (reason) => {
        this.#fail(`The inference worker stopped: ${reason}`);
      },
    );
  }

  open(
    model: ModelSource,
    options: InferenceOptions,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<InferenceSession>> {
    const call = this.#nextCall();
    this.#worker.post(
      { kind: ToInferenceWorkerKind.Open, call, sha256: model.sha256, options },
      [],
    );
    return this.#await(call, signal, (settle) => ({
      kind: FromInferenceWorkerKind.Opened,
      settle,
      model,
      signal,
    }));
  }

  /**
   * Reads the model's bytes for the open `call`, which the worker asked for,
   * and sends them, transferred; a read that fails answers the call with why,
   * and tells the worker to stop waiting.
   */
  async #supply(call: number, pending: Extract<Pending, { kind: 'opened' }>): Promise<void> {
    const read = await pending.model.read(pending.signal);
    // Answered meanwhile: cancelled, or the worker gone.
    if (this.#pending.get(call) !== pending) return;
    if (!read.ok) {
      this.#pending.delete(call);
      this.#worker.post({ kind: ToInferenceWorkerKind.Cancel, call }, []);
      pending.settle(read);
      return;
    }
    const model = movableModel(read.value);
    this.#worker.post({ kind: ToInferenceWorkerKind.Model, call, model }, [model.buffer]);
  }

  run(
    session: number,
    inputs: ReadonlyMap<string, Tensor>,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>> {
    if (this.#failure !== undefined) return Promise.resolve(this.#failure);
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    const call = this.#nextCall();
    const tensors = [...inputs].map(([name, one]) => movable({ name, ...one }));
    this.#worker.post(
      { kind: ToInferenceWorkerKind.Run, call, session, inputs: tensors },
      tensorTransfers(tensors),
    );
    return this.#await(call, signal, (settle) => ({
      kind: FromInferenceWorkerKind.Ran,
      session,
      settle,
    }));
  }

  /** Lets a session go: its runs not yet answered are answered as released. */
  release(session: number): void {
    for (const [call, pending] of this.#pending) {
      if (pending.kind === FromInferenceWorkerKind.Ran && pending.session === session) {
        this.#pending.delete(call);
        pending.settle(released());
      }
    }
    if (this.#failure === undefined) {
      this.#worker.post({ kind: ToInferenceWorkerKind.Release, session }, []);
    }
  }

  /** Ends the worker, answering whatever it held as `reason` says. */
  close(reason: string): void {
    this.#fail(reason);
  }

  #nextCall(): number {
    this.#calls += 1;
    return this.#calls;
  }

  /** The answer to `call`, or the cancelled answer as soon as `signal` is cancelled. */
  #await<TValue>(
    call: number,
    signal: CancellationSignal | undefined,
    pending: (settle: (result: DomainResult<TValue>) => void) => Pending,
  ): Promise<DomainResult<TValue>> {
    return new Promise((resolve) => {
      const abort = (): void => {
        if (!this.#pending.delete(call)) return;
        if (this.#failure === undefined) {
          this.#worker.post({ kind: ToInferenceWorkerKind.Cancel, call }, []);
        }
        resolve(cancelled());
      };
      this.#pending.set(
        call,
        pending((result) => {
          signal?.removeEventListener('abort', abort);
          resolve(result);
        }),
      );
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  #receive(value: unknown): void {
    const read = readFromInferenceWorker(value);
    if (!read.ok) {
      this.#fail(
        `The inference worker sent an answer that cannot be read: ${read.failures[0].summary}`,
      );
      return;
    }
    const reply = read.value;
    if (reply.kind === FromInferenceWorkerKind.Refused) {
      this.#fail(`The inference worker refused a message: ${reply.failures[0].summary}`);
      return;
    }
    const pending = this.#pending.get(reply.call);
    if (pending === undefined) {
      // A call answered here already, as cancelled; a session it opened is let go.
      if (reply.kind === FromInferenceWorkerKind.Opened) {
        this.#worker.post({ kind: ToInferenceWorkerKind.Release, session: reply.call }, []);
      }
      return;
    }
    if (reply.kind === FromInferenceWorkerKind.ModelWanted) {
      if (pending.kind === FromInferenceWorkerKind.Opened) {
        void this.#supply(reply.call, pending);
      } else {
        this.#fail('The inference worker asked for a model for a call that opens none.');
      }
      return;
    }
    this.#pending.delete(reply.call);
    this.#settle(pending, reply);
  }

  #settle(
    pending: Pending,
    reply: Exclude<FromInferenceWorker, { kind: 'refused' | 'model-wanted' }>,
  ): void {
    if (reply.kind === FromInferenceWorkerKind.Failed) {
      pending.settle(fail(...reply.failures));
    } else if (reply.kind === FromInferenceWorkerKind.Opened && pending.kind === reply.kind) {
      pending.settle(succeed(new WorkerSession(reply.call, reply, this)));
    } else if (reply.kind === FromInferenceWorkerKind.Ran && pending.kind === reply.kind) {
      pending.settle(
        succeed(new Map(reply.outputs.map(({ name, data, dims }) => [name, { data, dims }]))),
      );
    } else {
      pending.settle(
        workerFailed(`The inference worker answered call ${String(reply.call)} as ${reply.kind}.`),
      );
      this.#fail(`The inference worker answered a call with a reply of another kind.`);
    }
  }

  /** Ends the worker once: every call it held is answered with the reason, and its sessions with it. */
  #fail(summary: string): void {
    if (this.#failure !== undefined) return;
    const failed = workerFailed(summary);
    this.#failure = failed;
    this.#worker.terminate();
    this.#ended();
    for (const pending of this.#pending.values()) pending.settle(failed);
    this.#pending.clear();
  }
}

/** The inference port over the inference worker. */
export class WorkerInference implements InferencePort {
  readonly #connect: () => InferenceWorkerPort;
  readonly #capabilities: InferenceCapabilities;
  #connection: Connection | undefined;

  constructor(options: {
    /** A new connection to the inference worker. */
    readonly connect: () => InferenceWorkerPort;
    /** What the device offers, as the page started the workers with it. */
    readonly capabilities: InferenceCapabilities;
  }) {
    this.#connect = options.connect;
    this.#capabilities = options.capabilities;
  }

  open(
    model: ModelSource,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>> {
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    // Refused here as well as in the worker, so a session the device cannot
    // run starts no worker.
    const refusal = capabilityRefusal(this.#capabilities);
    if (refusal !== undefined) return Promise.resolve(fail(refusal));
    const connection = (this.#connection ??= new Connection(this.#connect(), () => {
      this.#connection = undefined;
    }));
    return connection.open(model, options, signal);
  }

  /**
   * Ends the connection to the worker, which the page found had failed for
   * `reason`: whatever it held is answered with the reason, and the next
   * session connects again.
   */
  failed(reason: string): void {
    this.#connection?.close(`The inference worker stopped: ${reason}`);
  }

  /** Ends the connection; whatever it held is answered as having failed. */
  dispose(): void {
    this.#connection?.close('The inference worker was closed.');
  }
}
