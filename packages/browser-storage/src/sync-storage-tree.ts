/**
 * The storage tree run against the origin-private file system directly, from
 * inside the dedicated worker that alone can write its files, where the whole
 * storage core runs (ADR-0022).
 *
 * Written against the {@link SyncDirectory} port, so every rule here is tested
 * in Node. It keeps the promises of the `StorageTree` port as the in-memory
 * tree the other packages are tested over does: a file exists from the moment
 * it is created and grows as it is written, creating one replaces any there, an
 * abandoned file is removed, a directory is made by writing into it and exists
 * while anything is in it, a listing is sorted, and a missing file or directory
 * is an answer rather than a failure. A path the tree cannot hold is refused as
 * a programmer error, as every tree does. Changes wait for one another by path
 * (`path-locks.ts`), because an access handle is exclusive; reads take a
 * snapshot and wait for nothing. Every refusal of the platform becomes a
 * `TreeFailure` of its kind, keeping the refusal as its cause, and an abort
 * rejects with the signal's own reason. The bytes a caller writes are read
 * where they lie, and neither kept nor given up, so the caller keeps its own.
 */

import {
  compareCodeUnits,
  isTreePath,
  isTreeSegment,
  type ByteSink,
  type ByteSource,
  type StorageTree,
  type TreeEntry,
} from '@audiogubbins/project-format';

import { bindDirectory } from './opfs-binding.js';
import { PathLocks } from './path-locks.js';
import { meansAbsent, treeFailureOf } from './platform-failures.js';
import type { FileSnapshot, SyncDirectory, SyncFile } from './sync-file-system.js';

function checkedPath(path: string): void {
  if (!isTreePath(path)) throw new Error(`Not a tree path: ${path}`);
}

function checkedFilePath(path: string): void {
  if (path === '') throw new Error('The root of the tree is not a file.');
  checkedPath(path);
}

/** A path as the directories it lies in and its own name. */
function split(path: string): { readonly parents: readonly string[]; readonly name: string } {
  const segments = path.split('/');
  return { parents: segments.slice(0, -1), name: segments.at(-1) ?? '' };
}

/** The refusal of a write the file system took only part of. */
function shortWrite(written: number, given: number): DOMException {
  return new DOMException(
    `The file system wrote ${String(written)} of ${String(given)} bytes.`,
    'UnknownError',
  );
}

/**
 * Runs the steps of an operation, a refusal of the platform made the designed
 * failure. The signal's reason is the caller's own, so it is passed on as it
 * is, even where it is a `DOMException`, as an abort's default reason is.
 */
async function refusing<Result>(
  step: () => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    const reason = signal?.aborted === true && error === signal.reason;
    if (error instanceof DOMException && !reason) throw treeFailureOf(error);
    throw error;
  }
}

/** Removes an entry, where there is one. */
async function removeEntry(directory: SyncDirectory, name: string): Promise<void> {
  await directory.remove(name).catch((error: unknown) => {
    if (!meansAbsent(error)) throw error;
  });
}

/** A file opened for a sink, and the function that frees its path. */
interface SinkFile {
  readonly parent: SyncDirectory;
  readonly name: string;
  readonly file: SyncFile;
  readonly release: () => void;
}

/**
 * A file being written in order, until it is closed or abandoned.
 *
 * Each operation runs after the sink's earlier ones, so a chunk is written
 * where the one before it ended however the caller awaits them.
 */
class SyncSink implements ByteSink {
  readonly #opened: SinkFile;
  #written = 0;
  #queue: Promise<void> = Promise.resolve();
  #open = true;

  constructor(opened: SinkFile) {
    this.#opened = opened;
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.#usable();
    await this.#after(async () => {
      const written = await this.#opened.file.write(chunk, this.#written);
      this.#written += written;
      if (written !== chunk.length) throw shortWrite(written, chunk.length);
    });
  }

  async close(): Promise<void> {
    this.#usable();
    this.#open = false;
    const { file, release } = this.#opened;
    await this.#after(async () => {
      try {
        await file.flush();
      } finally {
        await file.close();
        release();
      }
    });
  }

  /** Abandons the file, removing what was written, so no torn file is left. */
  async abort(): Promise<void> {
    this.#usable();
    this.#open = false;
    const { parent, name, file, release } = this.#opened;
    await this.#after(async () => {
      try {
        await file.close();
        await removeEntry(parent, name);
      } finally {
        release();
      }
    });
  }

  #usable(): void {
    if (!this.#open) throw new Error('A sink cannot be used once it is closed or aborted.');
  }

  #after(work: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(() => refusing(work));
    // The chain only orders the sink's operations; each one's outcome is
    // answered through `run`.
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** A storage tree over the file-system port (see the module comment). */
export class SyncStorageTree implements StorageTree {
  readonly #openRoot: () => Promise<SyncDirectory>;
  readonly #locks = new PathLocks();
  #root: Promise<SyncDirectory> | undefined;

  /**
   * Takes the root of the file system, asked for once, when the first
   * operation needs it, and a refusal of it kept as every operation's answer.
   */
  constructor(openRoot: () => Promise<SyncDirectory>) {
    this.#openRoot = openRoot;
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    checkedFilePath(path);
    signal?.throwIfAborted();
    return await refusing(async () => {
      const snapshot = await this.#snapshot(path);
      if (snapshot === undefined) return undefined;
      signal?.throwIfAborted();
      return await snapshot.read(0, snapshot.size);
    }, signal);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    checkedFilePath(path);
    const snapshot = await refusing(() => this.#snapshot(path));
    if (snapshot === undefined) return undefined;
    return {
      size: snapshot.size,
      read: (offset, length, signal) => this.#range(path, offset, length, signal),
    };
  }

  /**
   * A range of a file as it is now, as a read of the file opened at the path
   * is: short, or empty, where it has shrunk or gone.
   */
  async readRange(
    path: string,
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    checkedFilePath(path);
    return await this.#range(path, offset, length, signal);
  }

  /**
   * Replaces a file's bytes. The file is sized first, so a write the storage
   * has no room for is refused before any byte of the old one is lost.
   */
  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    checkedFilePath(path);
    await refusing(async () => {
      const release = await this.#locks.acquire(path, signal);
      try {
        signal?.throwIfAborted();
        const { parents, name } = split(path);
        const directory = await this.#directoryAt(parents, true);
        const file = await (await directory.file(name, true)).open();
        try {
          await file.truncate(bytes.length);
          const written = await file.write(bytes, 0);
          if (written !== bytes.length) throw shortWrite(written, bytes.length);
          await file.flush();
        } finally {
          await file.close();
        }
      } finally {
        release();
      }
    }, signal);
  }

  /** Opens a file for a sink, emptied, and holds its path until the sink ends. */
  async createFile(path: string): Promise<ByteSink> {
    checkedFilePath(path);
    return await refusing(async () => {
      const release = await this.#locks.acquire(path);
      try {
        const { parents, name } = split(path);
        const parent = await this.#directoryAt(parents, true);
        const file = await (await parent.file(name, true)).open();
        try {
          await file.truncate(0);
        } catch (error) {
          await file.close();
          throw error;
        }
        return new SyncSink({ parent, name, file, release });
      } catch (error) {
        release();
        throw error;
      }
    });
  }

  /** Removes a file or a directory whole; nothing there is not a failure. */
  async remove(path: string): Promise<void> {
    checkedPath(path);
    await refusing(async () => {
      const release = await this.#locks.acquire(path);
      try {
        if (path === '') {
          const root = await this.#rootDirectory();
          const names: string[] = [];
          for await (const entry of root.entries()) names.push(entry.name);
          for (const name of names) await root.remove(name);
          return;
        }
        const { parents, name } = split(path);
        const parent = await this.#existingDirectory(parents);
        if (parent !== undefined) await removeEntry(parent, name);
      } finally {
        release();
      }
    });
  }

  /**
   * A directory's entries, sorted by name. An entry whose name no tree path can
   * hold was not written through the tree, and is not part of it.
   */
  async list(directory: string): Promise<readonly TreeEntry[]> {
    checkedPath(directory);
    return await refusing(async () => {
      const found = await this.#existingDirectory(directory === '' ? [] : directory.split('/'));
      const entries: TreeEntry[] = [];
      if (found !== undefined) {
        for await (const entry of found.entries()) {
          if (isTreeSegment(entry.name)) entries.push(entry);
        }
      }
      return entries.sort((one, other) => compareCodeUnits(one.name, other.name));
    });
  }

  async #range(
    path: string,
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0) {
      throw new RangeError('A range is read from a whole offset for a whole length.');
    }
    signal?.throwIfAborted();
    return await refusing(async () => {
      const snapshot = await this.#snapshot(path);
      signal?.throwIfAborted();
      return snapshot === undefined
        ? new Uint8Array(0)
        : await snapshot.read(offset, Math.max(0, length));
    }, signal);
  }

  #rootDirectory(): Promise<SyncDirectory> {
    this.#root ??= this.#openRoot();
    return this.#root;
  }

  async #directoryAt(segments: readonly string[], create: boolean): Promise<SyncDirectory> {
    let directory = await this.#rootDirectory();
    for (const name of segments) directory = await directory.directory(name, create);
    return directory;
  }

  /** The directory at the segments, or `undefined` where there is none. */
  async #existingDirectory(segments: readonly string[]): Promise<SyncDirectory | undefined> {
    try {
      return await this.#directoryAt(segments, false);
    } catch (error) {
      if (meansAbsent(error)) return undefined;
      throw error;
    }
  }

  /** The file as it is now, or `undefined` where there is none. */
  async #snapshot(path: string): Promise<FileSnapshot | undefined> {
    const { parents, name } = split(path);
    try {
      const directory = await this.#directoryAt(parents, false);
      return await (await directory.file(name, false)).snapshot();
    } catch (error) {
      if (meansAbsent(error)) return undefined;
      throw error;
    }
  }
}

/**
 * The root of the origin-private file system, bound to the port. Without one,
 * as in a browser that offers none to workers, it is refused as unsupported,
 * which the tree reports as unavailable.
 */
function originPrivateRoot(
  readRoot: (() => Promise<FileSystemDirectoryHandle>) | undefined,
): () => Promise<SyncDirectory> {
  return async () => {
    if (readRoot === undefined) {
      throw new DOMException(
        'This browser offers no private storage to the storage worker.',
        'NotSupportedError',
      );
    }
    return bindDirectory(await readRoot());
  };
}

/**
 * The storage tree over the origin-private file system, for the storage
 * worker's composition root, which passes `readOriginPrivateRoot(navigator)`
 * from the capabilities package. Without a root, every operation is refused as
 * unavailable.
 */
export function originPrivateTree(
  readRoot: (() => Promise<FileSystemDirectoryHandle>) | undefined,
): StorageTree {
  return new SyncStorageTree(originPrivateRoot(readRoot));
}
