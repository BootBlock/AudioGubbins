/**
 * The storage worker's wiring: reading each message the page sends, handing it
 * to the handler, and posting each answer back with its bytes given up.
 *
 * The worker's own entry module is the application's, beside the composition
 * root, because the worker reads its root directory through the capabilities
 * package, the one place the browser is asked for anything (REQ-EXEC-136.4): it
 * calls {@link serveOriginPrivateTree} with its global scope and
 * `readOriginPrivateRoot(navigator)`. A message the protocol does not allow is
 * answered with a fault rather than dropped, so the page learns that the two
 * sides disagree (REQ-EXEC-136.12).
 */

import type { SyncDirectory } from './sync-file-system.js';
import { SyncStorageTree, originPrivateRoot } from './sync-storage-tree.js';
import { TreeHandler } from './tree-handler.js';
import { readPageMessage, transferOf, type WorkerMessage } from './tree-protocol.js';

/** The worker's global scope, as far as serving the tree uses it. */
export interface TreeWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, options: StructuredSerializeOptions): void;
}

/** Serves the tree over a root given through the port, as the tests do. */
export function serveTree(scope: TreeWorkerScope, openRoot: () => Promise<SyncDirectory>): void {
  const answer = (message: WorkerMessage): void => {
    scope.postMessage(message, { transfer: transferOf(message) });
  };
  const handler = new TreeHandler(new SyncStorageTree(openRoot), answer);
  scope.addEventListener('message', (event) => {
    const reading = readPageMessage(event.data);
    if (reading.ok) handler.receive(reading.message);
    else answer(reading.answer);
  });
}

/**
 * Serves the tree over the origin-private file system, from inside the
 * dedicated worker, where alone its files can be written. Without a root, as in
 * a browser that offers none to workers, every request is refused as
 * unavailable.
 */
export function serveOriginPrivateTree(
  scope: TreeWorkerScope,
  readRoot: (() => Promise<FileSystemDirectoryHandle>) | undefined,
): void {
  serveTree(scope, originPrivateRoot(readRoot));
}
