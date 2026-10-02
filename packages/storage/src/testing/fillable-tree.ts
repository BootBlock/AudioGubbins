/**
 * A storage tree that can be filled and emptied while it is in use, for the
 * quota tests: while full, every write is refused with the tree's `quota`
 * failure before a byte is written, as a browser's storage refuses one, and
 * every read, listing and removal still works.
 *
 * `fullAtWrite` fills it at the write numbered so, counted from 1 over every
 * write, so a test can fill it at each write of a sequence in turn.
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
    this.refuseWhileFull();
    await this.inner.writeFile(path, bytes, signal);
  }

  async createFile(path: string): Promise<ByteSink> {
    this.refuseWhileFull();
    const sink = await this.inner.createFile(path);
    return {
      write: async (chunk) => {
        this.refuseWhileFull();
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

  private refuseWhileFull(): void {
    this.writes += 1;
    if (this.writes === this.fullAtWrite) this.full = true;
    if (this.full) throw new TreeFailure(TreeFailureKind.Quota, 'The test storage is full.');
  }
}
