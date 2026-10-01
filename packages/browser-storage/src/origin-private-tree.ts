/**
 * The storage tree every project and every media object is kept in, over the
 * origin-private file system, through one dedicated worker (ADR-0020).
 *
 * The files are written through synchronous access handles, which Safari at the
 * floor offers where it offers no writable stream, and which every floor
 * browser offers only in a dedicated worker. This is the page's side: it
 * refuses a path the tree cannot hold as a programmer error, as every tree
 * does, and sends everything else to the worker (`tree-handler.ts`), which runs
 * it on the tree there (`sync-storage-tree.ts`). Bytes sent are copied once,
 * because the caller keeps its own, and moved from there; bytes read arrive
 * moved (G4).
 */

import {
  TreeFailure,
  TreeFailureKind,
  isTreePath,
  type ByteSink,
  type ByteSource,
  type StorageTree,
  type TreeEntry,
} from '@audiogubbins/project-format';

import { WorkerChannel, type TreeWorker } from './worker-channel.js';
import type { TreeAnswer } from './tree-protocol.js';

function checkedPath(path: string): void {
  if (!isTreePath(path)) throw new Error(`Not a tree path: ${path}`);
}

function checkedFilePath(path: string): void {
  if (path === '') throw new Error('The root of the tree is not a file.');
  checkedPath(path);
}

/** The defect of an answer of a kind the call it answers is never given. */
function unexpected(answer: TreeAnswer): Error {
  return new Error(`The storage worker answered ${answer.type} where it could not.`);
}

/** Resolves where the worker answered that it is done, and fails otherwise. */
function done(answer: TreeAnswer): void {
  if (answer.type !== 'done') throw unexpected(answer);
}

/** A storage tree over the origin-private file system (see the module comment). */
class OriginPrivateTree implements StorageTree {
  readonly #channel: WorkerChannel;

  constructor(channel: WorkerChannel) {
    this.#channel = channel;
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    checkedFilePath(path);
    const answer = await this.#channel.request({ type: 'read-file', path }, signal);
    if (answer.type === 'absent') return undefined;
    if (answer.type !== 'bytes') throw unexpected(answer);
    return new Uint8Array(answer.bytes);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    checkedFilePath(path);
    const answer = await this.#channel.request({ type: 'open-file', path });
    if (answer.type === 'absent') return undefined;
    if (answer.type !== 'size') throw unexpected(answer);
    const { size } = answer;
    return {
      size,
      read: async (offset, length, signal) => {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0) {
          throw new RangeError('A range is read from a whole offset for a whole length.');
        }
        const range = await this.#channel.request(
          { type: 'read-range', path, offset, length: Math.max(0, length) },
          signal,
        );
        if (range.type !== 'bytes') throw unexpected(range);
        return new Uint8Array(range.bytes);
      },
    };
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    checkedFilePath(path);
    done(
      await this.#channel.request(
        { type: 'write-file', path, bytes: bytes.slice().buffer },
        signal,
      ),
    );
  }

  async createFile(path: string): Promise<ByteSink> {
    checkedFilePath(path);
    const channel = this.#channel;
    const created = await channel.request({ type: 'create-file', path });
    done(created);
    // The worker keeps the open file under the id of the call that made it.
    const sink = created.id;
    let open = true;
    const end = (): void => {
      if (!open) throw new Error('A sink cannot be used once it is closed or aborted.');
    };
    return {
      write: async (chunk) => {
        end();
        done(await channel.request({ type: 'write-chunk', sink, bytes: chunk.slice().buffer }));
      },
      close: async () => {
        end();
        open = false;
        done(await channel.request({ type: 'close-file', sink }));
      },
      abort: async () => {
        end();
        open = false;
        done(await channel.request({ type: 'abort-file', sink }));
      },
    };
  }

  async remove(path: string): Promise<void> {
    checkedPath(path);
    done(await this.#channel.request({ type: 'remove', path }));
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    checkedPath(directory);
    const answer = await this.#channel.request({ type: 'list', path: directory });
    if (answer.type !== 'entries') throw unexpected(answer);
    return answer.entries;
  }
}

/**
 * Starts the storage worker and answers the tree over it.
 *
 * Given the worker's making rather than the worker, so a browser that refuses
 * to make one, as a page whose security policy forbids it does, gives a tree
 * that refuses every operation as unavailable instead of an exception where the
 * application starts. The composition root passes
 * `() => new Worker(new URL('…', import.meta.url), { type: 'module' })`.
 */
export function startOriginPrivateTree(createWorker: () => TreeWorker): StorageTree {
  let worker: TreeWorker | TreeFailure;
  try {
    worker = createWorker();
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    worker = new TreeFailure(TreeFailureKind.Unavailable, error.message, { cause: error });
  }
  return new OriginPrivateTree(new WorkerChannel(worker));
}
