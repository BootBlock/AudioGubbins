/**
 * A view of a storage tree that one window writes through and that a test can
 * pause at a chosen write or removal, as a browser freezes a tab mid-way, so
 * another window can act in between and the interleaving is the test's to
 * choose rather than the scheduler's.
 */

import type { ByteSink, ByteSource, StorageTree, TreeEntry } from '@audiogubbins/project-format';

/** A pause set at an operation: when it is reached, and how to let it go on. */
export interface Pause {
  /** Settles once the operation is reached and held. */
  readonly reached: Promise<void>;

  /** Lets the held operation go on. */
  readonly resume: () => void;
}

interface Armed {
  readonly operation: 'write' | 'remove';
  readonly matches: (path: string) => boolean;
  readonly reach: () => void;
  readonly held: Promise<void>;
}

/** A tree that holds one chosen operation until the test lets it go (see the module comment). */
export class PausingTree implements StorageTree {
  private readonly inner: StorageTree;
  private armed: Armed | undefined;

  constructor(inner: StorageTree) {
    this.inner = inner;
  }

  /** Holds the next `operation` on a path `matches` accepts, once, until resumed. */
  pauseAt(operation: 'write' | 'remove', matches: (path: string) => boolean): Pause {
    let reach: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    let resume: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    this.armed = { operation, matches, reach, held };
    return { reached, resume };
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    return await this.inner.readFile(path, signal);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    return await this.inner.openFile(path);
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    await this.holdAt('write', path);
    await this.inner.writeFile(path, bytes, signal);
  }

  async createFile(path: string): Promise<ByteSink> {
    await this.holdAt('write', path);
    return await this.inner.createFile(path);
  }

  async remove(path: string): Promise<void> {
    await this.holdAt('remove', path);
    await this.inner.remove(path);
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    return await this.inner.list(directory);
  }

  private async holdAt(operation: Armed['operation'], path: string): Promise<void> {
    const { armed } = this;
    if (armed?.operation !== operation || !armed.matches(path)) return;
    this.armed = undefined;
    armed.reach();
    await armed.held;
  }
}
