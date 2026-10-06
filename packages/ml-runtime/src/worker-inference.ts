/**
 * The inference port on the page's side of the inference worker (ADR-0062).
 *
 * A runtime keeps the threads it was started with, so each runtime
 * configuration a session needs (`runtimeConfigurationOf`) runs in a worker of
 * its own, made on the first session that needs it and kept for the next. Each
 * call is a message; each answer is read field by field and settles the call
 * it names. A cancelled call is answered at once and the worker told; a
 * session that opened for a call already answered is let go. Inputs' buffers
 * are transferred, not copied; a model's bytes are copied, since the caller's
 * pack cache keeps them. A worker that fails, or answers what cannot be read,
 * is ended, and every call and session it held fails with the reason; the next
 * session makes a new one.
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
  runtimeConfigurationOf,
  type InferenceExecution,
  type InferenceOptions,
  type RuntimeSetup,
} from './inference-options.js';
import {
  cancelled,
  inputRefusal,
  released,
  type InferencePort,
  type InferenceSession,
  type ModelBytes,
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
import { tensor, type Tensor, type TensorInfo } from './tensor.js';

/** The page's end of an inference worker. */
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
    }
  | {
      readonly kind: typeof FromInferenceWorkerKind.Ran;
      readonly session: number;
      readonly settle: (result: DomainResult<ReadonlyMap<string, Tensor>>) => void;
    };

function workerFailed(summary: string): DomainFailureResult {
  return fail(failure('inference.worker-failed', FailureKind.Unrecoverable, summary));
}

/** The model's bytes as a copy can carry them: alone in their buffer, so nothing around them is copied too. */
function modelMessage(model: ModelBytes): { model: ModelBytes; transfer: readonly ArrayBuffer[] } {
  if (model.byteOffset === 0 && model.byteLength === model.buffer.byteLength) {
    return { model, transfer: [] };
  }
  const own = model.slice();
  return { model: own, transfer: [own.buffer] };
}

/** Why `inputs` cannot be sent: a tensor whose dimensions miss its data, or a misfit to the model. */
function inputsRefusal(
  declared: readonly TensorInfo[],
  inputs: ReadonlyMap<string, Tensor>,
): DomainFailureResult | undefined {
  for (const one of inputs.values()) {
    const read = tensor(one.data, one.dims);
    if (!read.ok) return read;
  }
  return inputRefusal(declared, inputs);
}

/** A session in a worker. */
class WorkerSession implements InferenceSession {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  readonly execution: InferenceExecution;
  readonly #id: number;
  readonly #connection: Connection;
  #released = false;

  constructor(
    id: number,
    described: Pick<InferenceSession, 'inputs' | 'outputs' | 'execution'>,
    connection: Connection,
  ) {
    this.#id = id;
    this.inputs = described.inputs;
    this.outputs = described.outputs;
    this.execution = described.execution;
    this.#connection = connection;
  }

  run(
    inputs: ReadonlyMap<string, Tensor>,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>> {
    if (this.#released) return Promise.resolve(released());
    // Refused here, so a caller's mistake answers the caller rather than
    // reaching the worker as a message it would refuse whole.
    const refusal = inputsRefusal(this.inputs, inputs);
    if (refusal !== undefined) return Promise.resolve(refusal);
    return this.#connection.run(this.#id, inputs, signal);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#connection.release(this.#id);
  }
}

/** One worker and the calls and sessions it holds. */
class Connection {
  readonly #worker: InferenceWorkerPort;
  readonly #ended: () => void;
  readonly #pending = new Map<number, Pending>();
  #calls = 0;
  /** Why the worker is gone, once it is. */
  #failure: DomainFailureResult | undefined;

  constructor(worker: InferenceWorkerPort, setup: RuntimeSetup, ended: () => void) {
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
    worker.post({ kind: ToInferenceWorkerKind.Start, setup }, []);
  }

  open(
    bytes: ModelBytes,
    options: InferenceOptions,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<InferenceSession>> {
    const call = this.#nextCall();
    const { model, transfer } = modelMessage(bytes);
    this.#worker.post({ kind: ToInferenceWorkerKind.Open, call, model, options }, transfer);
    return this.#await(call, signal, (settle) => ({
      kind: FromInferenceWorkerKind.Opened,
      settle,
    }));
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
    this.#pending.delete(reply.call);
    this.#settle(pending, reply);
  }

  #settle(pending: Pending, reply: Exclude<FromInferenceWorker, { kind: 'refused' }>): void {
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

/** The inference port over inference workers, one for each runtime configuration. */
export class WorkerInference implements InferencePort {
  readonly #createWorker: () => InferenceWorkerPort;
  readonly #setup: RuntimeSetup;
  readonly #connections = new Map<string, Connection>();

  constructor(options: {
    readonly createWorker: () => InferenceWorkerPort;
    readonly setup: RuntimeSetup;
  }) {
    this.#createWorker = options.createWorker;
    this.#setup = options.setup;
  }

  open(
    model: ModelBytes,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>> {
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    // Refused here as well as in the worker, so a session the device cannot
    // run starts no worker, and a preview's thread count that is no count
    // never reaches one as a message it would refuse whole.
    const refusal = capabilityRefusal(options, this.#setup.capabilities);
    if (refusal !== undefined) return Promise.resolve(fail(refusal));
    const { build, threads } = runtimeConfigurationOf(options);
    const key = `${build}:${String(threads)}`;
    let connection = this.#connections.get(key);
    if (connection === undefined) {
      connection = new Connection(this.#createWorker(), this.#setup, () => {
        this.#connections.delete(key);
      });
      this.#connections.set(key, connection);
    }
    return connection.open(model, options, signal);
  }

  /** Ends every worker; whatever they held is answered as having failed. */
  dispose(): void {
    for (const connection of [...this.#connections.values()]) {
      connection.close('The inference workers were closed.');
    }
  }
}
