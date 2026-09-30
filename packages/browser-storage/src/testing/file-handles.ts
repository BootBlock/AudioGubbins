/**
 * File and folder handles for tests, standing in for the ones Chromium's
 * pickers hand over, with the permission methods Chromium gives them.
 *
 * The browser's own classes do not exist in the test environment, and the
 * adapters check what they are handed with `instanceof`, so
 * {@link installFakeHandles} puts these in their place for a test's length. A
 * file's contents can be replaced or removed under its handle, as another
 * program would.
 */

import { vi } from 'vitest';

class FakeHandle {
  readonly name: string;
  /** The permission the handle answers with, and what the user answers when asked. */
  readonly permission: {
    state: 'granted' | 'prompt' | 'denied';
    answer: 'granted' | 'denied';
    /** Whether a request answers a gesture still in force, without which the browser refuses it. */
    activated: boolean;
  } = { state: 'granted', answer: 'granted', activated: true };

  /** The access each question about the permission was asked for, in order. */
  readonly modesAsked: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return Promise.resolve(Object.is(other, this));
  }

  queryPermission(descriptor: { readonly mode: string }): Promise<string> {
    this.modesAsked.push(descriptor.mode);
    return Promise.resolve(this.permission.state);
  }

  requestPermission(descriptor: { readonly mode: string }): Promise<string> {
    this.modesAsked.push(descriptor.mode);
    if (!this.permission.activated) {
      return Promise.reject(
        new DOMException('User activation is required to request permissions.', 'SecurityError'),
      );
    }
    if (this.permission.state === 'prompt') this.permission.state = this.permission.answer;
    return Promise.resolve(this.permission.state);
  }
}

/** The browser's writable file stream, over the chunks written to it, in order. */
class FakeWritable
  extends WritableStream<FileSystemWriteChunkType>
  implements FileSystemWritableFileStream
{
  constructor(onClose: (parts: readonly BlobPart[]) => void) {
    const parts: BlobPart[] = [];
    super({
      write: (chunk) => {
        if (typeof chunk === 'object' && 'type' in chunk && !(chunk instanceof Blob)) {
          throw new TypeError('A fake stream takes bytes, text or a blob, never a command.');
        }
        parts.push(chunk);
      },
      close: () => {
        onClose(parts);
      },
    });
  }

  async write(data: FileSystemWriteChunkType): Promise<void> {
    const writer = this.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  seek(): Promise<void> {
    return Promise.reject(new Error('A fake stream is written in order.'));
  }

  truncate(): Promise<void> {
    return Promise.reject(new Error('A fake stream is written in order.'));
  }
}

/** A file's handle, whose file can change or go under it. */
export class FakeFileHandle extends FakeHandle implements FileSystemFileHandle {
  readonly kind = 'file';
  #file: File | undefined;

  constructor(file: File) {
    super(file.name);
    this.#file = file;
  }

  /** Replaces the file under the handle, as another program writing it would. */
  replace(file: File): void {
    this.#file = file;
  }

  /** Removes the file under the handle. */
  delete(): void {
    this.#file = undefined;
  }

  getFile(): Promise<File> {
    return this.#file === undefined
      ? Promise.reject(new DOMException('The file is not there.', 'NotFoundError'))
      : Promise.resolve(this.#file);
  }

  /**
   * A stream that replaces the file once it closes, as the browser's writes a
   * copy it swaps in then, and leaves it as it was where it is aborted.
   */
  createWritable(): Promise<FileSystemWritableFileStream> {
    return Promise.resolve(
      new FakeWritable((parts) => {
        this.#file = new File([...parts], this.name);
      }),
    );
  }
}

/** Why a fake folder has nothing by a name. */
function absent(name: string): DOMException {
  return new DOMException(`There is nothing called ${name} here.`, 'NotFoundError');
}

/** A folder's handle, listing the handles given it, which opens, makes and removes by name. */
export class FakeDirectoryHandle extends FakeHandle implements FileSystemDirectoryHandle {
  readonly kind = 'directory';
  readonly #children: (FakeFileHandle | FakeDirectoryHandle)[];

  constructor(name: string, children: readonly (FakeFileHandle | FakeDirectoryHandle)[]) {
    super(name);
    this.#children = [...children];
  }

  async *values(): AsyncGenerator<FakeFileHandle | FakeDirectoryHandle> {
    for (const child of [...this.#children]) {
      await Promise.resolve();
      yield child;
    }
  }

  getDirectoryHandle(
    name: string,
    options: { readonly create?: boolean } = {},
  ): Promise<FileSystemDirectoryHandle> {
    const found = this.#children.find((child) => child.name === name);
    if (found instanceof FakeDirectoryHandle) return Promise.resolve(found);
    if (found !== undefined || options.create !== true) return Promise.reject(absent(name));
    const made = new FakeDirectoryHandle(name, []);
    this.#children.push(made);
    return Promise.resolve(made);
  }

  getFileHandle(
    name: string,
    options: { readonly create?: boolean } = {},
  ): Promise<FileSystemFileHandle> {
    const found = this.#children.find((child) => child.name === name);
    if (found instanceof FakeFileHandle) return Promise.resolve(found);
    if (found !== undefined || options.create !== true) return Promise.reject(absent(name));
    const made = new FakeFileHandle(new File([], name));
    this.#children.push(made);
    return Promise.resolve(made);
  }

  removeEntry(name: string): Promise<void> {
    const index = this.#children.findIndex((child) => child.name === name);
    if (index < 0) return Promise.reject(absent(name));
    this.#children.splice(index, 1);
    return Promise.resolve();
  }

  resolve(): Promise<string[] | null> {
    return Promise.resolve(null);
  }
}

/** Puts the fake classes where the browser's own would be, until globals are unstubbed. */
export function installFakeHandles(): void {
  vi.stubGlobal('FileSystemHandle', FakeHandle);
  vi.stubGlobal('FileSystemFileHandle', FakeFileHandle);
  vi.stubGlobal('FileSystemDirectoryHandle', FakeDirectoryHandle);
}
