/**
 * The storage worker's side of the tree: carrying out each request the page
 * sends against the tree over the origin-private file system, and answering it
 * once.
 *
 * Every rule of the tree is the tree's own (`sync-storage-tree.ts`); this only
 * turns a request into a call of it and its outcome into an answer, and keeps
 * each sink the page has open under the id of the request that made it.
 */

import { TreeFailure, type ByteSink } from '@audiogubbins/project-format';

import { wholeBuffer } from './array-buffer-views.js';
import type { SyncStorageTree } from './sync-storage-tree.js';
import type { PageMessage, TreeAnswer, TreeRequest, WorkerMessage } from './tree-protocol.js';

/**
 * The answer to a request the page abandoned, a refusal, or a fault.
 *
 * A refusal is sent as the platform's error it keeps as its cause, which the
 * page rebuilds; a failure without one is not the tree's, and is a fault.
 */
function refusal(id: number, error: unknown, signal: AbortSignal): WorkerMessage {
  if (signal.aborted && error === signal.reason) return { type: 'cancelled', id };
  if (error instanceof TreeFailure && error.cause instanceof DOMException) {
    return {
      type: 'failed',
      id,
      kind: error.kind,
      name: error.cause.name,
      message: error.cause.message,
    };
  }
  return { type: 'fault', id, message: error instanceof Error ? error.message : String(error) };
}

/** Carries out the page's requests (see the module comment). */
export class TreeHandler {
  readonly #tree: SyncStorageTree;
  readonly #answer: (message: WorkerMessage) => void;
  readonly #pending = new Map<number, AbortController>();
  readonly #sinks = new Map<number, ByteSink>();

  /** Takes the tree to carry requests out on, and what posts a message to the page. */
  constructor(tree: SyncStorageTree, answer: (message: WorkerMessage) => void) {
    this.#tree = tree;
    this.#answer = answer;
  }

  /** Carries out a request, or abandons the one a cancel names. */
  receive(message: PageMessage): void {
    if (message.type === 'cancel') {
      this.#pending
        .get(message.target)
        ?.abort(new DOMException('The page abandoned the request.', 'AbortError'));
      return;
    }
    const controller = new AbortController();
    this.#pending.set(message.id, controller);
    void this.#settle(message, controller.signal).then((answer) => {
      this.#pending.delete(message.id);
      this.#answer(answer);
    });
  }

  /**
   * The request's answer, whatever became of it.
   *
   * Every error becomes an answer, because the page is waiting for one: a
   * refusal of the platform is reported by its kind, and anything else is a
   * fault the page rejects with, so a defect is seen where the call was made
   * rather than leaving it waiting for ever.
   */
  async #settle(request: TreeRequest, signal: AbortSignal): Promise<WorkerMessage> {
    try {
      return await this.#perform(request, signal);
    } catch (error) {
      return refusal(request.id, error, signal);
    }
  }

  /**
   * Calls the tree for a request. A sink's operations are handed to it as they
   * arrive, before anything is awaited, because the sink writes its chunks in
   * the order it is given them.
   */
  async #perform(request: TreeRequest, signal: AbortSignal): Promise<TreeAnswer> {
    const { id } = request;
    const tree = this.#tree;
    switch (request.type) {
      case 'read-file': {
        const bytes = await tree.readFile(request.path, signal);
        return bytes === undefined ? { type: 'absent', id } : this.#bytes(id, bytes);
      }
      case 'open-file': {
        const source = await tree.openFile(request.path);
        return source === undefined
          ? { type: 'absent', id }
          : { type: 'size', id, size: source.size };
      }
      case 'read-range':
        return this.#bytes(
          id,
          await tree.readRange(request.path, request.offset, request.length, signal),
        );
      case 'write-file':
        await tree.writeFile(request.path, new Uint8Array(request.bytes), signal);
        return { type: 'done', id };
      case 'create-file':
        this.#sinks.set(id, await tree.createFile(request.path));
        return { type: 'done', id };
      case 'write-chunk':
        await this.#sink(request.sink, false).write(new Uint8Array(request.bytes));
        return { type: 'done', id };
      case 'close-file':
        await this.#sink(request.sink, true).close();
        return { type: 'done', id };
      case 'abort-file':
        await this.#sink(request.sink, true).abort();
        return { type: 'done', id };
      case 'remove':
        await tree.remove(request.path);
        return { type: 'done', id };
      case 'list':
        return { type: 'entries', id, entries: await tree.list(request.path) };
    }
  }

  #bytes(id: number, bytes: Uint8Array<ArrayBuffer>): TreeAnswer {
    return { type: 'bytes', id, bytes: wholeBuffer(bytes) };
  }

  /** The sink open under an id, forgotten where this ends it. */
  #sink(sinkId: number, ending: boolean): ByteSink {
    const sink = this.#sinks.get(sinkId);
    if (sink === undefined) {
      throw new Error(`No file is open for writing under sink ${String(sinkId)}.`);
    }
    if (ending) this.#sinks.delete(sinkId);
    return sink;
  }
}
