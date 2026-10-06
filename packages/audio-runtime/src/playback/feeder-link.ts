/**
 * The main thread's end of the feeder worker: typed messages out, typed
 * replies in.
 *
 * A reply crossed from the worker as a structured clone, so it is read with
 * the protocol's reader before anyone hears it; one that does not read, one
 * that could not be received at all (`messageerror`), and an error the
 * worker's script threw are each heard as a fault, since what the feeder feeds
 * is then in doubt and a listener waiting on it would wait for ever. The link
 * owns the worker, and terminating it is part of letting it go; so is the
 * worker's connection to the preview worker, given to the feeder as it starts,
 * which lets the preview worker give up the renders it held.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import type { PreviewConnection } from '../preview/preview-host.js';
import {
  FromFeederKind,
  ToFeederKind,
  readFromFeeder,
  type FromFeeder,
  type ToFeeder,
} from '../protocol/feeder-messages.js';

/** The events a feeder worker raises that the link listens for, by type. */
export interface FeederWorkerEvents {
  readonly message: MessageEvent;
  /** A message from the worker that could not be deserialised. */
  readonly messageerror: MessageEvent;
  /** An error the worker's script threw and did not catch, or its module failing to load. */
  readonly error: ErrorEvent;
}

/**
 * The part of a `Worker` the link uses, so a test can play the worker where
 * the test environment has none.
 */
export interface FeederWorkerPort {
  postMessage(message: ToFeeder, transfer: Transferable[]): void;
  addEventListener<TType extends keyof FeederWorkerEvents>(
    type: TType,
    listener: (event: FeederWorkerEvents[TType]) => void,
  ): void;
  removeEventListener<TType extends keyof FeederWorkerEvents>(
    type: TType,
    listener: (event: FeederWorkerEvents[TType]) => void,
  ): void;
  terminate(): void;
}

/** Hears every reply the feeder sends that reads as one. */
export type FeederListener = (message: FromFeeder) => void;

/** One feeder worker, spoken to and heard through the protocol. */
export class FeederLink {
  readonly #worker: FeederWorkerPort;
  readonly #logger: Logger;
  readonly #listeners = new Set<FeederListener>();
  readonly #previews: PreviewConnection | undefined;
  #disposed = false;

  /** Listens to `worker`, and gives it `previews`, its connection to the preview worker, where given. */
  constructor(worker: FeederWorkerPort, logger: Logger, previews?: PreviewConnection) {
    this.#worker = worker;
    this.#logger = logger;
    this.#previews = previews;
    worker.addEventListener('message', this.#received);
    worker.addEventListener('messageerror', this.#undeliverable);
    worker.addEventListener('error', this.#threw);
    if (previews !== undefined) {
      worker.postMessage({ kind: ToFeederKind.Previews, port: previews.port }, [previews.port]);
    }
  }

  /** Sends a message, transferring the memory and ports named rather than copying them. */
  send(message: ToFeeder, transfer: Transferable[] = []): void {
    if (this.#disposed) {
      // A wiring mistake: a disposed link's worker is terminated.
      throw new Error('This feeder link was disposed; its worker is gone.');
    }
    this.#worker.postMessage(message, transfer);
  }

  /** Hears every reply from now until the answer is called. */
  subscribe(listener: FeederListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Stops hearing the worker, drops every listener and terminates it. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#worker.removeEventListener('message', this.#received);
    this.#worker.removeEventListener('messageerror', this.#undeliverable);
    this.#worker.removeEventListener('error', this.#threw);
    this.#listeners.clear();
    this.#worker.terminate();
    this.#previews?.disconnect();
  }

  readonly #received = (event: MessageEvent): void => {
    const read = readFromFeeder(event.data);
    if (!read.ok) {
      const [problem] = read.failures;
      this.#logger.error('A reply from the feeder could not be read.', {
        code: problem.code,
        reason: problem.summary,
      });
      this.#tell({
        kind: FromFeederKind.Fault,
        message: `A reply from the feeder could not be read: ${problem.summary}`,
      });
      return;
    }
    this.#tell(read.value);
  };

  readonly #undeliverable = (): void => {
    this.#logger.error('A reply from the feeder could not be received.');
    this.#tell({
      kind: FromFeederKind.Fault,
      message: 'A message from the feeder could not be received, so what it feeds is in doubt.',
    });
  };

  readonly #threw = (event: ErrorEvent): void => {
    // Handled here, where it is reported, rather than left for the console.
    event.preventDefault();
    this.#logger.error('The feeder stopped with an error.', { reason: event.message });
    this.#tell({
      kind: FromFeederKind.Fault,
      message: `The feeder stopped with an error: ${event.message}`,
    });
  };

  #tell(message: FromFeeder): void {
    // A copy, so a listener that unsubscribes while hearing a reply does not
    // make the one after it miss it.
    for (const listener of [...this.#listeners]) listener(message);
  }
}
