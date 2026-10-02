/**
 * Turns given to the storage worker's host during long storage work, so a
 * cancel or another call that arrived meanwhile is heard mid-path (ADR-0022).
 *
 * The worker's tree reads and writes through synchronous access handles, so a
 * walk of the whole storage, as a usage measurement is, would otherwise run to
 * its end before any message is read: the page's cancel would reach a call
 * already finished, and a write of the open project would wait behind it. So
 * the tree every storage path works through asks for a turn before each of its
 * operations, and the turns are given in slices: one only once a slice of time
 * has run since the last, so a short path pays nothing and a long one is heard
 * within a slice.
 */

import type {
  ByteSink,
  ByteSource,
  StorageTree,
  TreeEntry,
  YieldToHost,
} from '@audiogubbins/project-format';

/**
 * Turns given once `slice` milliseconds have run since the last, by
 * `elapsed`, a time that only moves on; every other is answered at once.
 */
export function turnsEvery(
  slice: number,
  elapsed: () => number,
  yieldToHost: YieldToHost,
): YieldToHost {
  let last = elapsed();
  return async () => {
    if (elapsed() - last < slice) return;
    await yieldToHost();
    last = elapsed();
  };
}

/** A tree that takes a turn before each of its operations (see the module comment). */
export class TurnTakingTree implements StorageTree {
  readonly #inner: StorageTree;
  readonly #turn: YieldToHost;

  constructor(inner: StorageTree, turn: YieldToHost) {
    this.#inner = inner;
    this.#turn = turn;
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    await this.#turn();
    return await this.#inner.readFile(path, signal);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    await this.#turn();
    return await this.#inner.openFile(path);
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    await this.#turn();
    await this.#inner.writeFile(path, bytes, signal);
  }

  async createFile(path: string): Promise<ByteSink> {
    await this.#turn();
    return await this.#inner.createFile(path);
  }

  async remove(path: string): Promise<void> {
    await this.#turn();
    await this.#inner.remove(path);
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    await this.#turn();
    return await this.#inner.list(directory);
  }
}
