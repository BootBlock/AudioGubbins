/**
 * A page and a storage worker joined in one test, as the browser joins them:
 * each message is cloned with its transfer list, so a buffer given up is
 * emptied on the sender's side, and arrives on a later task. Every message in
 * either direction is recorded, and a test may send either side anything as if
 * the other had, or report the worker failed or a message unreadable.
 */

import type { PortEndpoint } from '../protocol/port-channel.js';

/** One end of the pair: what it has been sent, and where it sends. */
class End implements PortEndpoint {
  readonly received: unknown[] = [];
  other: End | undefined;
  readonly #listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  /** Sends a message on a later task, cloned and with its buffers moved. */
  postMessage(message: unknown, options: StructuredSerializeOptions): void {
    const other = this.other;
    if (other === undefined) throw new Error('The pair is not joined.');
    other.receive(message, options.transfer ?? []);
  }

  receive(message: unknown, transfer: Transferable[]): void {
    const data: unknown = structuredClone(message, { transfer });
    setTimeout(() => {
      this.received.push(data);
      this.dispatch('message', new MessageEvent('message', { data }));
    }, 0);
  }

  dispatch(type: string, event: MessageEvent): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

/** A page and a worker joined, each side's end, and what each was sent. */
export interface PortPair {
  readonly page: PortEndpoint;
  readonly worker: PortEndpoint;

  /** Every message the worker was sent, in order. */
  readonly toWorker: readonly unknown[];

  /** Every message the page was sent, in order. */
  readonly toPage: readonly unknown[];

  /** Sends the page a message as if the worker had. */
  sendToPage(message: unknown): void;

  /** Sends the worker a message as if the page had. */
  sendToWorker(message: unknown): void;

  /** Reports the worker failed, as the browser does when its script cannot run. */
  fail(): void;

  /** Reports to the page that a message from the worker could not be read. */
  spoilToPage(): void;
}

/** Joins a page to a worker. */
export function portPair(): PortPair {
  const page = new End();
  const worker = new End();
  page.other = worker;
  worker.other = page;
  return {
    page,
    worker,
    toWorker: worker.received,
    toPage: page.received,
    sendToPage: (message) => {
      page.receive(message, []);
    },
    sendToWorker: (message) => {
      worker.receive(message, []);
    },
    fail: () => {
      page.dispatch('error', new MessageEvent('error'));
    },
    spoilToPage: () => {
      page.dispatch('messageerror', new MessageEvent('messageerror'));
    },
  };
}
