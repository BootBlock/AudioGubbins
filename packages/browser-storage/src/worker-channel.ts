/**
 * The page's side of the conversation with the storage worker: numbering each
 * request, matching each answer to it, abandoning a request whose signal
 * aborts, and turning each refusal into the failure its caller is owed.
 *
 * A refusal of the platform becomes a {@link TreeFailure} of its kind, with the
 * platform's error rebuilt as its cause. A worker that cannot start or stops
 * makes every request, then and after, a failure of kind `unavailable`, since
 * nothing more can be stored. A message the protocol does not allow, in either
 * direction, is a defect: the two sides disagree, so nothing either says can be
 * trusted, and every request then and after rejects with it (REQ-EXEC-136.12).
 */

import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

import {
  readWorkerMessage,
  transferOf,
  type TreeAnswer,
  type TreeCall,
  type TreeRequest,
  type WorkerMessage,
} from './tree-protocol.js';

/** The dedicated worker, as far as the page uses it: a `Worker` is one. */
export interface TreeWorker {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
  postMessage(message: unknown, options: StructuredSerializeOptions): void;
}

interface Pending {
  readonly resolve: (answer: TreeAnswer | typeof ABANDONED) => void;
  readonly reject: (reason: Error) => void;
}

/** What a call waits with once its signal aborts, before it throws the reason. */
const ABANDONED = Symbol('abandoned');

/**
 * A channel to a worker, or why every request now fails: the worker could not
 * be made or has gone, or the two sides disagree.
 */
type ChannelState = { readonly worker: TreeWorker } | { readonly broken: Error };

/** Requests to the storage worker, and their answers (see the module comment). */
export class WorkerChannel {
  readonly #pending = new Map<number, Pending>();
  #nextId = 0;
  #state: ChannelState;

  /**
   * Talks to the worker, or, where it could not be made, refuses every request
   * with why.
   */
  constructor(worker: TreeWorker | TreeFailure) {
    if (worker instanceof TreeFailure) {
      this.#state = { broken: worker };
      return;
    }
    this.#state = { worker };
    worker.addEventListener('message', (event) => {
      this.#receive(readWorkerMessage(event.data));
    });
    worker.addEventListener('error', () => {
      this.#break(
        new TreeFailure(
          TreeFailureKind.Unavailable,
          'The storage worker could not be started, or stopped working.',
        ),
      );
    });
    worker.addEventListener('messageerror', () => {
      this.#break(new Error('A message from the storage worker could not be read.'));
    });
  }

  /**
   * Sends a call and resolves to its answer. Rejects with the signal's reason
   * where it aborts first, and tells the worker to abandon the call.
   */
  async request(call: TreeCall, signal?: AbortSignal): Promise<TreeAnswer> {
    const state = this.#state;
    if ('broken' in state) throw state.broken;
    signal?.throwIfAborted();
    const { worker } = state;

    const id = this.#nextId;
    this.#nextId += 1;
    const request: TreeRequest = { ...call, id };
    const answer = await new Promise<TreeAnswer | typeof ABANDONED>((resolve, reject) => {
      // Sent before anything waits for it, so a message the browser cannot
      // clone rejects the call and leaves nothing waiting; no answer can
      // arrive before this task ends.
      worker.postMessage(request, { transfer: transferOf(request) });
      const onAbort = (): void => {
        if (!this.#pending.delete(id)) return;
        worker.postMessage({ type: 'cancel', target: id }, { transfer: [] });
        resolve(ABANDONED);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, {
        resolve: (answer) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(answer);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      });
    });
    if (answer !== ABANDONED) return answer;
    // Only an abort abandons a call, so this throws the signal's reason.
    signal?.throwIfAborted();
    throw new Error('A call was abandoned without its signal aborting.');
  }

  #receive(message: WorkerMessage | undefined): void {
    if (message === undefined) {
      this.#break(new Error('The storage worker sent a message the protocol does not allow.'));
      return;
    }
    if (message.type === 'unreadable') {
      // Which call the worker could not read is unknown, so every call is
      // answered by it.
      this.#break(new Error(`The storage worker could not read a request: ${message.message}`));
      return;
    }
    const pending = this.#pending.get(message.id);
    // An answer to a call already abandoned finds nothing waiting for it.
    if (pending === undefined) return;
    this.#pending.delete(message.id);
    switch (message.type) {
      case 'failed':
        pending.reject(
          new TreeFailure(message.kind, message.message, {
            cause: new DOMException(message.message, message.name),
          }),
        );
        return;
      case 'cancelled':
        pending.reject(new DOMException('The storage request was abandoned.', 'AbortError'));
        return;
      case 'fault':
        pending.reject(new Error(`The storage worker failed: ${message.message}`));
        return;
      default:
        pending.resolve(message);
    }
  }

  /** Fails every call waiting, and every call after, with why. */
  #break(reason: Error): void {
    if ('worker' in this.#state) this.#state = { broken: reason };
    const waiting = [...this.#pending.values()];
    this.#pending.clear();
    for (const pending of waiting) pending.reject(reason);
  }
}
