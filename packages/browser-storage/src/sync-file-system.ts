/**
 * The origin-private file system as the storage worker uses it: the port the
 * worker's handler is written against, so it is tested in Node over a file
 * system held in memory (`testing/memory-sync-file-system.ts`), and bound to
 * the browser's handles in `opfs-binding.ts`.
 *
 * Each member mirrors one handle method, and refuses as that method does, with
 * a `DOMException` of the name the file system specification gives:
 * `NotFoundError` where nothing is there, `TypeMismatchError` where an entry of
 * the other kind is, `QuotaExceededError` where the storage is full, and
 * `NoModificationAllowedError` where a file already has an access handle open,
 * which is exclusive (ADR-0020).
 */

import type { TreeEntry } from '@audiogubbins/project-format';

/** A directory: `FileSystemDirectoryHandle`. */
export interface SyncDirectory {
  /** `getDirectoryHandle(name, { create })`. */
  directory(name: string, create: boolean): Promise<SyncDirectory>;

  /** `getFileHandle(name, { create })`. */
  file(name: string, create: boolean): Promise<SyncFileEntry>;

  /** `removeEntry(name, { recursive: true })`. */
  remove(name: string): Promise<void>;

  /** `values()`, each as its name and kind, in no promised order. */
  entries(): AsyncIterable<TreeEntry>;
}

/** A file: `FileSystemFileHandle`. */
export interface SyncFileEntry {
  /**
   * `getFile()`: the file as it is now, read without an access handle, so a
   * read neither waits for nor blocks a writer in this or another tab.
   */
  snapshot(): Promise<FileSnapshot>;

  /** `createSyncAccessHandle()`: the file opened for writing, exclusively. */
  open(): Promise<SyncFile>;
}

/** A file as it was when it was looked at: a `File`. */
export interface FileSnapshot {
  readonly size: number;

  /** `slice(offset, offset + length).arrayBuffer()`: short past the end. */
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * An open file: `FileSystemSyncAccessHandle`.
 *
 * Asynchronous in this port although the handle is synchronous on every floor
 * browser, because the first releases of the handle answered some of these with
 * promises: the binding awaits either, and the handler is written for the one
 * that covers both.
 */
export interface SyncFile {
  /** `write(bytes, { at })`: the number of bytes written. */
  write(bytes: Uint8Array, at: number): Promise<number>;
  truncate(size: number): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
