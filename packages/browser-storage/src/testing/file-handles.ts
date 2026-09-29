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
  } = { state: 'granted', answer: 'granted' };

  constructor(name: string) {
    this.name = name;
  }

  isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return Promise.resolve(Object.is(other, this));
  }

  queryPermission(): Promise<string> {
    return Promise.resolve(this.permission.state);
  }

  requestPermission(): Promise<string> {
    if (this.permission.state === 'prompt') this.permission.state = this.permission.answer;
    return Promise.resolve(this.permission.state);
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

  createWritable(): Promise<FileSystemWritableFileStream> {
    return Promise.reject(new Error('A fake file handle writes nothing.'));
  }
}

/** A folder's handle, listing the handles given it. */
export class FakeDirectoryHandle extends FakeHandle implements FileSystemDirectoryHandle {
  readonly kind = 'directory';
  readonly #children: readonly (FakeFileHandle | FakeDirectoryHandle)[];

  constructor(name: string, children: readonly (FakeFileHandle | FakeDirectoryHandle)[]) {
    super(name);
    this.#children = children;
  }

  async *values(): AsyncGenerator<FakeFileHandle | FakeDirectoryHandle> {
    for (const child of this.#children) {
      await Promise.resolve();
      yield child;
    }
  }

  getDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
    return Promise.reject(new Error('A fake folder opens nothing by name.'));
  }

  getFileHandle(): Promise<FileSystemFileHandle> {
    return Promise.reject(new Error('A fake folder opens nothing by name.'));
  }

  removeEntry(): Promise<void> {
    return Promise.reject(new Error('A fake folder removes nothing.'));
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
