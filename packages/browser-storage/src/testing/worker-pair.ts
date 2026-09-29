/**
 * A page and a storage worker joined in one test, as the browser joins them:
 * each message is cloned with its transfer list, so a buffer given up is
 * emptied on the sender's side, and arrives on a later task. Every message in
 * either direction is recorded, and a test may send the page anything as if the
 * worker had, or report the worker failed.
 */

import type { StorageTree } from '@audiogubbins/project-format';

import { startOriginPrivateTree } from '../origin-private-tree.js';
import { serveTree, type TreeWorkerScope } from '../serve-tree.js';
import type { SyncDirectory } from '../sync-file-system.js';
import type { TreeWorker } from '../worker-channel.js';

/** One end of the pair: what it has been sent, and where it sends. */
class End implements TreeWorker, TreeWorkerScope {
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
    other.receive(message, options);
  }

  receive(message: unknown, options: StructuredSerializeOptions): void {
    const data: unknown = structuredClone(message, options);
    setTimeout(() => {
      this.received.push(data);
      this.dispatch('message', new MessageEvent('message', { data }));
    }, 0);
  }

  dispatch(type: string, event: MessageEvent): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

/** A page and a worker joined, and the tree the page sees. */
export interface WorkerPair {
  readonly tree: StorageTree;

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
}

/** Joins a page to a worker serving a tree whose root is given, or refused. */
export function workerPair(serve: (scope: TreeWorkerScope) => void = () => undefined): WorkerPair {
  const page = new End();
  const worker = new End();
  page.other = worker;
  worker.other = page;
  serve(worker);
  return {
    tree: startOriginPrivateTree(() => page),
    toWorker: worker.received,
    toPage: page.received,
    sendToPage: (message) => {
      page.receive(message, {});
    },
    sendToWorker: (message) => {
      worker.receive(message, {});
    },
    fail: () => {
      page.dispatch('error', new MessageEvent('error'));
    },
  };
}

/** Joins a page to a worker serving the tree over the given root. */
export function servedPair(root: () => Promise<SyncDirectory>): WorkerPair {
  return workerPair((scope) => {
    serveTree(scope, root);
  });
}
