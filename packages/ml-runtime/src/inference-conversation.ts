/**
 * One thread's conversation with the inference worker, over the channel the
 * page connected it by.
 *
 * It serves the worker's port, the adapter over the runtime with its sessions
 * shared (`shared-sessions.ts`), to that thread: each message read field by
 * field, each session kept by the call that opened it, a model's bytes asked of
 * the thread only where the port reads them, each call answered once with its
 * outcome, its outputs' buffers transferred. A call the thread cancels is
 * cancelled here too, and a session opened for a cancelled call is let go at
 * once rather than kept. Sessions are the conversation's own, so a thread can
 * neither run nor release another's, and closing the conversation, once its
 * thread has gone, lets every one go.
 */

import {
  FailureKind,
  createCancellationSource,
  failure,
  succeed,
  type CancellationSignal,
  type CancellationSource,
  type DomainFailure,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  cancelled,
  released,
  type InferencePort,
  type InferenceSession,
  type ModelBytes,
} from './inference-port.js';
import { readToInferenceWorker } from './protocol/inference-message-reading.js';
import {
  FromInferenceWorkerKind,
  ToInferenceWorkerKind,
  movable,
  tensorTransfers,
  type FromInferenceWorker,
  type InferenceFailures,
  type NamedTensor,
  type ToInferenceWorker,
} from './protocol/inference-messages.js';

/** What a conversation is given by the worker that holds it. */
export interface ConversationHost {
  readonly post: (message: FromInferenceWorker, transfer: readonly ArrayBuffer[]) => void;
  /** The worker's runtime as it stands. */
  readonly runtime: () => WorkerRuntime;
}

/**
 * The worker's port, once the page has started it with a setup, or why there
 * is none: not started yet, or started with a setup it refused.
 */
export type WorkerRuntime =
  | { readonly kind: 'serving'; readonly port: InferencePort }
  | { readonly kind: 'unavailable'; readonly reason: DomainFailure };

type Message<TKind extends ToInferenceWorker['kind']> = Extract<
  ToInferenceWorker,
  { readonly kind: TKind }
>;

/** A thread's conversation with the inference worker (see the module comment). */
export class InferenceConversation {
  readonly #host: ConversationHost;
  readonly #sessions = new Map<number, InferenceSession>();
  /** The calls not yet answered, each cancelled when the thread cancels it. */
  readonly #calls = new Map<number, CancellationSource>();
  /** The opens waiting for the model's bytes the thread was asked for, by call. */
  readonly #wanted = new Map<number, (result: DomainResult<ModelBytes>) => void>();
  #closed = false;

  constructor(host: ConversationHost) {
    this.#host = host;
  }

  /** Handles one message from the thread. */
  receive(value: unknown): void {
    if (this.#closed) return;
    const read = readToInferenceWorker(value);
    if (!read.ok) {
      this.#host.post({ kind: FromInferenceWorkerKind.Refused, failures: read.failures }, []);
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case ToInferenceWorkerKind.Open:
        this.#open(message).catch(this.#faulted(message.call));
        return;
      case ToInferenceWorkerKind.Model:
        this.#wanted.get(message.call)?.(succeed(message.model));
        return;
      case ToInferenceWorkerKind.Run:
        this.#run(message).catch(this.#faulted(message.call));
        return;
      case ToInferenceWorkerKind.Cancel:
        this.#calls.get(message.call)?.cancel();
        return;
      case ToInferenceWorkerKind.Release:
        this.#sessions.get(message.session)?.release();
        this.#sessions.delete(message.session);
        return;
    }
  }

  /** A message that could not be deserialised: the thread cannot know which call it was. */
  messageFailed(): void {
    if (this.#closed) return;
    this.#host.post(
      {
        kind: FromInferenceWorkerKind.Refused,
        failures: [
          failure(
            'inference.message-malformed',
            FailureKind.Unrecoverable,
            'A message to the inference worker could not be received.',
          ),
        ],
      },
      [],
    );
  }

  /**
   * Ends the conversation, its thread having gone: every call is cancelled
   * and every session let go, and nothing more is answered.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const call of this.#calls.values()) call.cancel();
    this.#calls.clear();
    for (const session of this.#sessions.values()) session.release();
    this.#sessions.clear();
  }

  async #open({
    call,
    sha256,
    options,
  }: Message<typeof ToInferenceWorkerKind.Open>): Promise<void> {
    const runtime = this.#host.runtime();
    if (runtime.kind === 'unavailable') {
      this.#failed(call, runtime.reason);
      return;
    }
    const { port } = runtime;
    const source = this.#begin(call);
    const model = { sha256, read: (signal?: CancellationSignal) => this.#modelOf(call, signal) };
    const opened = await port.open(model, options, source.signal);
    this.#calls.delete(call);
    if (!opened.ok) {
      this.#answer(call, opened);
      return;
    }
    const session = opened.value;
    if (source.signal.aborted || this.#closed) {
      // Opened for a caller who has gone: nobody will ever release it.
      session.release();
      return;
    }
    this.#sessions.set(call, session);
    const { inputs, outputs, execution } = session;
    this.#host.post({ kind: FromInferenceWorkerKind.Opened, call, inputs, outputs, execution }, []);
  }

  /**
   * The model's bytes for the open `call`, asked of the thread, or the
   * cancelled answer once `signal` is: the thread's cancelling the call, or
   * its going.
   */
  #modelOf(
    call: number,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<ModelBytes>> {
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    return new Promise((resolve) => {
      const settle = (result: DomainResult<ModelBytes>): void => {
        this.#wanted.delete(call);
        signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = (): void => {
        settle(cancelled());
      };
      this.#wanted.set(call, settle);
      signal?.addEventListener('abort', abort, { once: true });
      this.#post({ kind: FromInferenceWorkerKind.ModelWanted, call }, []);
    });
  }

  async #run({ call, session, inputs }: Message<typeof ToInferenceWorkerKind.Run>): Promise<void> {
    const open = this.#sessions.get(session);
    if (open === undefined) {
      this.#answer(call, released());
      return;
    }
    const source = this.#begin(call);
    const ran = await open.run(new Map(inputs.map((one) => [one.name, one])), source.signal);
    this.#calls.delete(call);
    if (!ran.ok) {
      this.#answer(call, ran);
      return;
    }
    const outputs = [...ran.value].map(([name, one]): NamedTensor => movable({ name, ...one }));
    this.#post({ kind: FromInferenceWorkerKind.Ran, call, outputs }, tensorTransfers(outputs));
  }

  /**
   * Answers a call whose port threw rather than answering, which the port's
   * contract forbids: the thread would otherwise wait on the call for ever,
   * since a rejection in a worker reaches no listener of the thread's.
   */
  #faulted(call: number): (error: unknown) => void {
    return (error) => {
      this.#calls.delete(call);
      const reason = error instanceof Error ? error.message : String(error);
      this.#failed(
        call,
        failure(
          'inference.worker-failed',
          FailureKind.Unrecoverable,
          `The inference runtime failed: ${reason}`,
        ),
      );
    };
  }

  #begin(call: number): CancellationSource {
    const source = createCancellationSource();
    this.#calls.set(call, source);
    return source;
  }

  /** Answers a call that failed; the thread passes over the answer to one it cancelled. */
  #answer(call: number, result: DomainFailureResult): void {
    const [first, ...rest] = result.failures;
    this.#failed(call, first, ...rest);
  }

  #failed(call: number, ...failures: InferenceFailures): void {
    this.#post({ kind: FromInferenceWorkerKind.Failed, call, failures }, []);
  }

  /** Posts to the thread, unless it has gone. */
  #post(message: FromInferenceWorker, transfer: readonly ArrayBuffer[]): void {
    if (!this.#closed) this.#host.post(message, transfer);
  }
}
