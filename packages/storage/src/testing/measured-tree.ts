/**
 * A storage tree that measures the audio passing through it, for the tests
 * that hold a long import or export to never holding its file whole: the
 * largest write and the largest read of a file under the staging or the media
 * store, each a buffer the storage held at once, and the bytes written and
 * read there, over any tree it wraps.
 *
 * A test may also be told of each write, as a stream that makes its blocks as
 * they are asked for sees how far its reader has written.
 */

import type { ByteSink, ByteSource, StorageTree, TreeEntry } from '@audiogubbins/project-format';

/** The directories audio is written to and read from: the staging, and the media store's. */
const AUDIO_PREFIXES: readonly string[] = ['cache/staging/', 'media/'];

function isAudio(path: string): boolean {
  return AUDIO_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** A tree measuring the audio written to and read from `inner` (see the module comment). */
export class MeasuredTree implements StorageTree {
  largestWrite = 0;
  largestRead = 0;
  written = 0;
  read = 0;
  private readonly inner: StorageTree;
  private readonly onWrite: (path: string, bytes: number) => void;

  constructor(
    inner: StorageTree,
    onWrite: (path: string, bytes: number) => void = () => undefined,
  ) {
    this.inner = inner;
    this.onWrite = onWrite;
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const bytes = await this.inner.readFile(path, signal);
    if (bytes !== undefined) this.measureRead(path, bytes.length);
    return bytes;
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    const source = await this.inner.openFile(path);
    if (source === undefined) return undefined;
    return {
      size: source.size,
      read: async (offset, length, signal) => {
        const bytes = await source.read(offset, length, signal);
        this.measureRead(path, bytes.length);
        return bytes;
      },
    };
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    await this.inner.writeFile(path, bytes, signal);
    this.measureWrite(path, bytes.length);
  }

  async createFile(path: string): Promise<ByteSink> {
    const sink = await this.inner.createFile(path);
    return {
      write: async (chunk) => {
        await sink.write(chunk);
        this.measureWrite(path, chunk.length);
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

  private measureRead(path: string, bytes: number): void {
    if (!isAudio(path)) return;
    this.largestRead = Math.max(this.largestRead, bytes);
    this.read += bytes;
  }

  private measureWrite(path: string, bytes: number): void {
    if (!isAudio(path)) return;
    this.largestWrite = Math.max(this.largestWrite, bytes);
    this.written += bytes;
    this.onWrite(path, bytes);
  }
}
