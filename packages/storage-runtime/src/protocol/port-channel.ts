/**
 * One side of the port between the page and the storage worker: calling the
 * other side's operations, serving its own, and the events either sends.
 *
 * Each call is numbered, answered once, and abandoned where its signal aborts:
 * the other side is told, and aborts the signal it gave the handler, so a long
 * path stops where it next looks. An answer arriving for a call already
 * abandoned finds nothing waiting for it, and a cancel arriving for a call
 * already answered finds nothing to abort.
 *
 * A refusal of the storage tree crosses as its kind and becomes the same
 * {@link TreeFailure} on the calling side; anything else a handler throws
 * crosses as a fault, so a defect is seen where the call was made rather than
 * leaving it waiting for ever. An end that cannot start or stops makes every
 * call, then and after, a failure of kind `unavailable`, since nothing more
 * can be stored. A message the protocol does not allow, or one that cannot be
 * read, is a defect: the two sides disagree, so nothing either says can be
 * trusted, and every call then and after rejects with it (REQ-EXEC-136.12).
 */

import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

import {
  Transferring,
  type Answered,
  type Handlers,
  type OperationTable,
  type ServeContext,
} from './operations.js';
import { readPortMessage, type CallOutcome, type PortMessage } from './port-messages.js';

/**
 * Where one side's messages go and arrive: a `Worker` on the page, the
 * worker's own global scope inside it, and either end of the test pair.
 */
export interface PortEndpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

/** How a call is made: the signal that abandons it, and the buffers it gives up. */
export interface CallOptions {
  readonly signal?: AbortSignal;
  readonly transfer?: readonly Transferable[];
}

interface PendingCall {
  readonly settle: (outcome: CallOutcome) => void;
  readonly reject: (reason: Error) => void;
}

/** What a call waits with once its signal aborts, before it throws the reason. */
const ABANDONED = Symbol('abandoned');

function servesOperation<TTable extends OperationTable>(
  handlers: Handlers<TTable>,
  name: string,
): name is keyof TTable & string {
  return Object.hasOwn(handlers, name);
}

/**
 * Hands a call to its handler. The argument is not read: the table both sides
 * compile from types it by its operation (ADR-0022).
 */
function perform<TTable extends OperationTable, TName extends keyof TTable>(
  handlers: Handlers<TTable>,
  name: TName,
  argument: unknown,
  context: ServeContext,
): Promise<Answered<TTable[TName]['answer']>> {
  return handlers[name](argument, context);
}

/** Why a handler did not answer, as the caller is told it. */
function refusalOf(error: unknown, signal: AbortSignal): CallOutcome {
  if (signal.aborted && error === signal.reason) return { kind: 'cancelled' };
  if (error instanceof TreeFailure) {
    return { kind: 'tree-refused', failure: error.kind, message: error.message };
  }
  return { kind: 'fault', message: error instanceof Error ? error.message : String(error) };
}

/**
 * Whether the platform refused to clone a message. Read by its name, since the
 * platform's `DOMException` need not be the global one: under a test's
 * simulated document it is not.
 */
function isUncloneable(error: unknown): error is Error {
  return error instanceof Error && error.name === 'DataCloneError';
}

/** A call's answer, or the failure the caller is owed in its place. */
function answerOf(operation: string, outcome: CallOutcome): unknown {
  switch (outcome.kind) {
    case 'value':
      return outcome.value;
    case 'tree-refused':
      throw new TreeFailure(outcome.failure, outcome.message);
    case 'cancelled':
      throw new DOMException(`The call of ${operation} was abandoned.`, 'AbortError');
    case 'fault':
      throw new Error(`The call of ${operation} failed: ${outcome.message}`);
  }
}

/** Calls of `TCalls` on the other side, and `TServes` served for it (see the module comment). */
export class PortChannel<TCalls extends OperationTable, TServes extends OperationTable> {
  readonly #endpoint: PortEndpoint;
  readonly #calls = new Map<number, PendingCall>();
  readonly #serving = new Map<number, AbortController>();
  readonly #listeners = new Map<string, Set<(value: unknown) => void>>();
  #handlers: Handlers<TServes> | undefined;
  #nextId = 0;
  #broken: Error | undefined;

  /** Sends and receives through an endpoint, from now until the channel breaks. */
  constructor(endpoint: PortEndpoint) {
    this.#endpoint = endpoint;
    endpoint.addEventListener('message', (event) => {
      this.#receive(event.data);
    });
    endpoint.addEventListener('messageerror', () => {
      this.#break(new Error('A message from the other side of the port could not be read.'));
    });
    endpoint.addEventListener('error', () => {
      this.#break(
        new TreeFailure(
          TreeFailureKind.Unavailable,
          'The other side of the port could not be started, or stopped working.',
        ),
      );
    });
  }

  /**
   * Calls an operation and resolves to its answer. Rejects with the signal's
   * reason where it aborts first, and tells the other side to abandon it.
   */
  async call<TName extends keyof TCalls & string>(
    operation: TName,
    argument: TCalls[TName]['argument'],
    options: CallOptions = {},
  ): Promise<TCalls[TName]['answer']> {
    if (this.#broken !== undefined) throw this.#broken;
    const { signal, transfer = [] } = options;
    signal?.throwIfAborted();

    const id = this.#nextId;
    this.#nextId += 1;
    const outcome = await new Promise<CallOutcome | typeof ABANDONED>((resolve, reject) => {
      // Sent before anything waits for it, so a call the browser cannot clone
      // rejects and leaves nothing waiting; no answer can arrive before this
      // task ends.
      this.#post({ type: 'call', id, operation, argument }, transfer);
      const onAbort = (): void => {
        if (!this.#calls.delete(id)) return;
        this.#post({ type: 'cancel', target: id }, []);
        resolve(ABANDONED);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#calls.set(id, {
        settle: (answer) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(answer);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      });
    });
    if (outcome !== ABANDONED) return answerOf(operation, outcome);
    // Only an abort abandons a call, so this throws the signal's reason.
    signal?.throwIfAborted();
    throw new Error('A call was abandoned without its signal aborting.');
  }

  /** Serves the other side's calls, once, with a handler for each operation. */
  serve(handlers: Handlers<TServes>): void {
    if (this.#handlers !== undefined) throw new Error('The channel already serves its calls.');
    this.#handlers = handlers;
  }

  /**
   * Sends the other side an event on a stream. Nothing is sent once the
   * channel is broken: an event is owed no answer, and the side that would
   * hear it has gone or cannot be trusted.
   */
  emit(stream: string, value: unknown, transfer: readonly Transferable[] = []): void {
    if (this.#broken !== undefined) return;
    this.#post({ type: 'event', stream, value }, transfer);
  }

  /** Hears each event the other side sends on a stream, until the returned call. */
  listen(stream: string, listener: (value: unknown) => void): () => void {
    const listeners = this.#listeners.get(stream) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(stream, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(stream);
    };
  }

  #post(message: PortMessage, transfer: readonly Transferable[]): void {
    this.#endpoint.postMessage(message, [...transfer]);
  }

  #receive(data: unknown): void {
    if (this.#broken !== undefined) return;
    const read = readPortMessage(data);
    if (!read.ok) {
      const why = read.failures.map((one) => one.summary).join(' ');
      this.#break(new Error(`The other side sent a message the protocol does not allow: ${why}`));
      return;
    }
    const message = read.value;
    switch (message.type) {
      case 'call':
        this.#serveCall(message.id, message.operation, message.argument);
        return;
      case 'cancel':
        this.#serving
          .get(message.target)
          ?.abort(new DOMException('The caller abandoned the call.', 'AbortError'));
        return;
      case 'answer':
        this.#settle(message.id, message.outcome);
        return;
      case 'event':
        for (const listener of [...(this.#listeners.get(message.stream) ?? [])]) {
          listener(message.value);
        }
    }
  }

  #settle(id: number, outcome: CallOutcome): void {
    const pending = this.#calls.get(id);
    // An answer to a call already abandoned finds nothing waiting for it.
    if (pending === undefined) return;
    this.#calls.delete(id);
    pending.settle(outcome);
  }

  #serveCall(id: number, operation: string, argument: unknown): void {
    const controller = new AbortController();
    this.#serving.set(id, controller);
    void this.#outcomeOf(operation, argument, controller.signal).then((answer) => {
      this.#serving.delete(id);
      this.#answer(id, answer);
    });
  }

  /**
   * The outcome of a call served, whatever became of it. Every error becomes
   * an outcome, because the caller is waiting for one.
   */
  async #outcomeOf(
    operation: string,
    argument: unknown,
    signal: AbortSignal,
  ): Promise<Transferring<CallOutcome>> {
    try {
      const handlers = this.#handlers;
      if (handlers === undefined || !servesOperation(handlers, operation)) {
        throw new Error(`No operation named ${operation} is served.`);
      }
      const answered = await perform(handlers, operation, argument, { signal });
      return answered instanceof Transferring
        ? new Transferring({ kind: 'value', value: answered.value }, answered.transfer)
        : new Transferring({ kind: 'value', value: answered }, []);
    } catch (error) {
      return new Transferring(refusalOf(error, signal), []);
    }
  }

  /**
   * Sends an answer, unless the channel broke while it was worked out. An
   * answer the browser cannot clone fails its own call as a fault, not the
   * channel, since the next answer may clone.
   */
  #answer(id: number, answer: Transferring<CallOutcome>): void {
    if (this.#broken !== undefined) return;
    try {
      this.#post({ type: 'answer', id, outcome: answer.value }, answer.transfer);
    } catch (error) {
      if (!isUncloneable(error)) throw error;
      const message = `The answer could not be sent: ${error.message}`;
      this.#post({ type: 'answer', id, outcome: { kind: 'fault', message } }, []);
    }
  }

  /** Fails every call waiting, and every call after, with why, and stops serving. */
  #break(reason: Error): void {
    if (this.#broken !== undefined) return;
    this.#broken = reason;
    const waiting = [...this.#calls.values()];
    this.#calls.clear();
    for (const pending of waiting) pending.reject(reason);
    const serving = [...this.#serving.values()];
    this.#serving.clear();
    for (const controller of serving) controller.abort(reason);
  }
}
