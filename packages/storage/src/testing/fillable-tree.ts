/**
 * A storage tree that can be filled and emptied while it is in use, for the
 * quota tests: while full, every write is refused with the tree's `quota`
 * failure before a byte is written, as a browser's storage refuses one, and
 * every read, listing and removal still works.
 *
 * `fullAtWrite` fills it at the write numbered so, counted from 1 over every
 * write, so a test can fill it at each write of a sequence in turn, and
 * `fullUnder` refuses every write under a directory alone, as a storage left
 * with room for some of what is written to it does.
 */

import {
  TreeFailure,
  TreeFailureKind,
  type ByteSink,
  type ByteSource,
  type StorageTree,
  type TreeEntry,
} from '@audiogubbins/project-format';

/** A tree that refuses writes while full (see the module comment). */
export class FillableTree implements StorageTree {
  full = false;
  writes = 0;
  fullAtWrite: number | undefined;
  fullUnder: string | undefined;
  private readonly inner: StorageTree;

  constructor(inner: StorageTree) {
    this.inner = inner;
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    return await this.inner.readFile(path, signal);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    return await this.inner.openFile(path);
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.refuseWhileFull(path);
    await this.inner.writeFile(path, bytes, signal);
  }

  async createFile(path: string): Promise<ByteSink> {
    this.refuseWhileFull(path);
    const sink = await this.inner.createFile(path);
    return {
      write: async (chunk) => {
        this.refuseWhileFull(path);
        await sink.write(chunk);
      },
      close: async () => {
        await sink.close();
      },
      abort: async (reason) => {
        await sink.abort(reason);
      },
    };
  }

  async remove(path: string): Promise<void> {
    await this.inner.remove(path);
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    return await this.inner.list(directory);
  }

  private refuseWhileFull(path: string): void {
    this.writes += 1;
    if (this.writes === this.fullAtWrite) this.full = true;
    const under = this.fullUnder !== undefined && path.startsWith(`${this.fullUnder}/`);
    if (this.full || under) {
      throw new TreeFailure(TreeFailureKind.Quota, 'The test storage is full.');
    }
  }
}
