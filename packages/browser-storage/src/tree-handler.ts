/**
 * The storage worker's side of the tree: carrying out each request the page
 * sends against the origin-private file system, and answering it once.
 *
 * Written against the {@link SyncDirectory} port, so every rule here is tested
 * in Node. It keeps the promises of the `StorageTree` port as the in-memory
 * tree the other packages are tested over does: a file exists from the moment
 * it is created and grows as it is written, creating one replaces any there, an
 * abandoned file is removed, a directory is made by writing into it and exists
 * while anything is in it, a listing is sorted, and a missing file or directory
 * is an answer rather than a failure. Changes wait for one another by path
 * (`path-locks.ts`), because an access handle is exclusive; reads take a
 * snapshot and wait for nothing.
 */

import { compareCodeUnits, isTreeSegment, type TreeEntry } from '@audiogubbins/project-format';

import { wholeBuffer } from './array-buffer-views.js';
import { PathLocks } from './path-locks.js';
import { failureKindOf, meansAbsent } from './platform-failures.js';
import type { FileSnapshot, SyncDirectory, SyncFile } from './sync-file-system.js';
import type { PageMessage, TreeAnswer, TreeRequest, WorkerMessage } from './tree-protocol.js';

/** A file being written through a sink, until it is closed or abandoned. */
interface OpenSink {
  readonly parent: SyncDirectory;
  readonly name: string;
  readonly file: SyncFile;
  readonly release: () => void;
  written: number;

  /** The sink's operations so far, each run after the last, in the order sent. */
  queue: Promise<void>;
}

/** A path as the directories it lies in and its own name. */
function split(path: string): { readonly parents: readonly string[]; readonly name: string } {
  const segments = path.split('/');
  return { parents: segments.slice(0, -1), name: segments.at(-1) ?? '' };
}

/** The answer to a request the page abandoned, a refusal, or a fault. */
function refusal(id: number, error: unknown, signal: AbortSignal): WorkerMessage {
  if (signal.aborted && error === signal.reason) return { type: 'cancelled', id };
  if (error instanceof DOMException) {
    return {
      type: 'failed',
      id,
      kind: failureKindOf(error),
      name: error.name,
      message: error.message,
    };
  }
  return { type: 'fault', id, message: error instanceof Error ? error.message : String(error) };
}

/** The refusal of a write the file system took only part of. */
function shortWrite(written: number, given: number): DOMException {
  return new DOMException(
    `The file system wrote ${String(written)} of ${String(given)} bytes.`,
    'UnknownError',
  );
}

/** Carries out the page's requests (see the module comment). */
export class TreeHandler {
  readonly #openRoot: () => Promise<SyncDirectory>;
  readonly #answer: (message: WorkerMessage) => void;
  readonly #locks = new PathLocks();
  readonly #pending = new Map<number, AbortController>();
  readonly #sinks = new Map<number, OpenSink>();
  #root: Promise<SyncDirectory> | undefined;

  /**
   * Takes the root of the file system, asked for once, when the first request
   * needs it, and a refusal of it kept as every request's answer; and the
   * function that posts a message to the page.
   */
  constructor(openRoot: () => Promise<SyncDirectory>, answer: (message: WorkerMessage) => void) {
    this.#openRoot = openRoot;
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

  #perform(request: TreeRequest, signal: AbortSignal): Promise<TreeAnswer> {
    const { id } = request;
    switch (request.type) {
      case 'read-file':
        return this.#readFile(id, request.path, signal);
      case 'open-file':
        return this.#openFile(id, request.path);
      case 'read-range':
        return this.#readRange(id, request.path, request.offset, request.length, signal);
      case 'write-file':
        return this.#writeFile(id, request.path, new Uint8Array(request.bytes), signal);
      case 'create-file':
        return this.#createFile(id, request.path);
      case 'write-chunk':
        return this.#onSink(request.sink, (sink) => this.#writeChunk(id, sink, request.bytes));
      case 'close-file':
        return this.#onSink(request.sink, (sink) => this.#closeSink(id, request.sink, sink));
      case 'abort-file':
        return this.#onSink(request.sink, (sink) => this.#abortSink(id, request.sink, sink));
      case 'remove':
        return this.#remove(id, request.path, signal);
      case 'list':
        return this.#list(id, request.path);
    }
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

  async #readFile(id: number, path: string, signal: AbortSignal): Promise<TreeAnswer> {
    const snapshot = await this.#snapshot(path);
    if (snapshot === undefined) return { type: 'absent', id };
    signal.throwIfAborted();
    const bytes = await snapshot.read(0, snapshot.size);
    return { type: 'bytes', id, bytes: wholeBuffer(bytes) };
  }

  async #openFile(id: number, path: string): Promise<TreeAnswer> {
    const snapshot = await this.#snapshot(path);
    return snapshot === undefined
      ? { type: 'absent', id }
      : { type: 'size', id, size: snapshot.size };
  }

  /** A range of the file as it is now: short, or empty, where it has shrunk or gone. */
  async #readRange(
    id: number,
    path: string,
    offset: number,
    length: number,
    signal: AbortSignal,
  ): Promise<TreeAnswer> {
    const snapshot = await this.#snapshot(path);
    signal.throwIfAborted();
    const bytes =
      snapshot === undefined
        ? new ArrayBuffer(0)
        : wholeBuffer(await snapshot.read(offset, length));
    return { type: 'bytes', id, bytes };
  }

  /**
   * Replaces a file's bytes. The file is sized first, so a write the storage
   * has no room for is refused before any byte of the old one is lost.
   */
  async #writeFile(
    id: number,
    path: string,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<TreeAnswer> {
    const release = await this.#locks.acquire(path, signal);
    try {
      signal.throwIfAborted();
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
      return { type: 'done', id };
    } finally {
      release();
    }
  }

  /** Opens a file for a sink, emptied, and holds its path until the sink ends. */
  async #createFile(id: number, path: string): Promise<TreeAnswer> {
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
      this.#sinks.set(id, { parent, name, file, release, written: 0, queue: Promise.resolve() });
      return { type: 'done', id };
    } catch (error) {
      release();
      throw error;
    }
  }

  /**
   * Runs an operation of an open sink after the sink's earlier ones, so each
   * chunk is written where the one before it ended however the page's messages
   * are awaited.
   */
  #onSink(sinkId: number, work: (sink: OpenSink) => Promise<TreeAnswer>): Promise<TreeAnswer> {
    const sink = this.#sinks.get(sinkId);
    if (sink === undefined) {
      return Promise.reject(new Error(`No file is open for writing under sink ${String(sinkId)}.`));
    }
    const run = sink.queue.then(() => work(sink));
    // The chain only orders the sink's operations; each one's outcome is
    // answered through `run`.
    sink.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #writeChunk(id: number, sink: OpenSink, chunk: ArrayBuffer): Promise<TreeAnswer> {
    const bytes = new Uint8Array(chunk);
    const written = await sink.file.write(bytes, sink.written);
    sink.written += written;
    if (written !== bytes.length) throw shortWrite(written, bytes.length);
    return { type: 'done', id };
  }

  async #closeSink(id: number, sinkId: number, sink: OpenSink): Promise<TreeAnswer> {
    this.#sinks.delete(sinkId);
    try {
      await sink.file.flush();
    } finally {
      await sink.file.close();
      sink.release();
    }
    return { type: 'done', id };
  }

  /** Abandons a sink's file, removing what was written, so no torn file is left. */
  async #abortSink(id: number, sinkId: number, sink: OpenSink): Promise<TreeAnswer> {
    this.#sinks.delete(sinkId);
    try {
      await sink.file.close();
      await sink.parent.remove(sink.name).catch((error: unknown) => {
        if (!meansAbsent(error)) throw error;
      });
    } finally {
      sink.release();
    }
    return { type: 'done', id };
  }

  /** Removes a file or a directory whole; nothing there is not a failure. */
  async #remove(id: number, path: string, signal: AbortSignal): Promise<TreeAnswer> {
    const release = await this.#locks.acquire(path, signal);
    try {
      signal.throwIfAborted();
      if (path === '') {
        const root = await this.#rootDirectory();
        const names: string[] = [];
        for await (const entry of root.entries()) names.push(entry.name);
        for (const name of names) await root.remove(name);
        return { type: 'done', id };
      }
      const { parents, name } = split(path);
      const parent = await this.#existingDirectory(parents);
      await parent?.remove(name).catch((error: unknown) => {
        if (!meansAbsent(error)) throw error;
      });
      return { type: 'done', id };
    } finally {
      release();
    }
  }

  /**
   * A directory's entries, sorted by name. An entry whose name no tree path can
   * hold was not written through the tree, and is not part of it.
   */
  async #list(id: number, path: string): Promise<TreeAnswer> {
    const directory = await this.#existingDirectory(path === '' ? [] : path.split('/'));
    const entries: TreeEntry[] = [];
    if (directory !== undefined) {
      for await (const entry of directory.entries()) {
        if (isTreeSegment(entry.name)) entries.push(entry);
      }
    }
    entries.sort((one, other) => compareCodeUnits(one.name, other.name));
    return { type: 'entries', id, entries };
  }
}
