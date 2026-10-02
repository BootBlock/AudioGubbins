/**
 * A view of a storage tree that lets a test act at a chosen operation, such
 * as giving up the work at the read of a chosen file, and counts every
 * operation made through it from then on, so the test sees whether the work
 * stopped there or ran on.
 */

import type { ByteSink, ByteSource, StorageTree, TreeEntry } from '@audiogubbins/project-format';

/** The operations a test can act at. */
export type WatchedOperation = 'read' | 'open' | 'list' | 'write' | 'remove';

interface Watch {
  readonly operation: WatchedOperation;
  readonly matches: (path: string) => boolean;
  readonly act: () => void;
}

/** A tree that acts once at a chosen operation (see the module comment). */
export class WatchedTree implements StorageTree {
  readonly #inner: StorageTree;
  #watch: Watch | undefined;
  #since: number | undefined;

  constructor(inner: StorageTree) {
    this.#inner = inner;
  }

  /** Calls `act` as the first `operation` on a path `matches` accepts begins. */
  actAt(operation: WatchedOperation, matches: (path: string) => boolean, act: () => void): void {
    this.#watch = { operation, matches, act };
  }

  /** How many operations began after the one acted at, or `undefined` before it. */
  get operationsSince(): number | undefined {
    return this.#since;
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    this.#note('read', path);
    return await this.#inner.readFile(path, signal);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    this.#note('open', path);
    return await this.#inner.openFile(path);
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.#note('write', path);
    await this.#inner.writeFile(path, bytes, signal);
  }

  async createFile(path: string): Promise<ByteSink> {
    this.#note('write', path);
    return await this.#inner.createFile(path);
  }

  async remove(path: string): Promise<void> {
    this.#note('remove', path);
    await this.#inner.remove(path);
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    this.#note('list', directory);
    return await this.#inner.list(directory);
  }

  #note(operation: WatchedOperation, path: string): void {
    if (this.#since !== undefined) {
      this.#since += 1;
      return;
    }
    const watch = this.#watch;
    if (watch?.operation !== operation || !watch.matches(path)) return;
    this.#since = 0;
    watch.act();
  }
}
