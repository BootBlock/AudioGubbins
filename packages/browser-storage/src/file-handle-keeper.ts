/**
 * Keeping the handles of files the user linked, so a project can find them
 * again after the page reloads (REQ-STOR-104).
 *
 * The browser can keep a file handle in IndexedDB and nowhere else. Each is
 * kept under an opaque token from the injected source, never under its path or
 * name: the key is recorded in the project, and a path there would say where
 * the user keeps their files, and would stop naming the file the moment it
 * moved (REQ-STOR-104, REQ-PRIV-161).
 *
 * The folder chosen for backups is kept the same way, under the name of the use
 * it is kept for rather than a token, since this browser keeps one folder for
 * each use and nothing records the key (REQ-STOR-105). Every such name begins
 * with the project format's `FOLDER_KEY_PREFIX`, which the rule for a recorded
 * token refuses, so no linked file can name a folder's handle.
 *
 * IndexedDB is reached through `handle-database.ts`, so a test drives it with
 * a small fake, and a refusal becomes a `TreeFailure` of its kind, the one
 * failure every storage adapter rejects with (`platform-failures.ts`).
 */

import type { TokenSource } from '@audiogubbins/media-store';
import { FOLDER_KEY_PREFIX } from '@audiogubbins/project-format';

import {
  HANDLE_STORE,
  HandleStore,
  committed,
  settled,
  type HandleDatabaseFactory,
} from './handle-database.js';

/** What a kept folder is for, and the key it is kept under. */
export const FolderUse = {
  /** The folder each backup of a project is copied to (REQ-STOR-105). */
  Backups: `${FOLDER_KEY_PREFIX}backups`,
} as const;

/** What a kept folder is for, and the key it is kept under. */
export type FolderUse = (typeof FolderUse)[keyof typeof FolderUse];

/** The kept handles of linked files and chosen folders (see the module comment). */
export class FileHandleKeeper {
  readonly #database: HandleStore;
  readonly #nextToken: TokenSource;

  constructor(factory: HandleDatabaseFactory, nextToken: TokenSource) {
    this.#database = new HandleStore(factory);
    this.#nextToken = nextToken;
  }

  /** Keeps a handle, and answers the key it is kept under. */
  async keep(handle: FileSystemFileHandle): Promise<string> {
    const key = this.#nextToken();
    const transaction = (await this.#database.open()).transaction(HANDLE_STORE, 'readwrite');
    const done = committed(transaction, 'Keeping a file handle');
    transaction.objectStore(HANDLE_STORE).put(handle, key);
    await done;
    return key;
  }

  /** The handle kept under the key, or `undefined` where none is. */
  async find(key: string): Promise<FileSystemFileHandle | undefined> {
    const found = await this.#found(key);
    return found instanceof FileSystemFileHandle ? found : undefined;
  }

  /** Keeps a folder for a use, in place of the one kept for it before. */
  async keepFolder(use: FolderUse, folder: FileSystemDirectoryHandle): Promise<void> {
    const transaction = (await this.#database.open()).transaction(HANDLE_STORE, 'readwrite');
    const done = committed(transaction, 'Keeping a folder handle');
    transaction.objectStore(HANDLE_STORE).put(folder, use);
    await done;
  }

  /** The folder kept for a use, or `undefined` where none is. */
  async findFolder(use: FolderUse): Promise<FileSystemDirectoryHandle | undefined> {
    const found = await this.#found(use);
    return found instanceof FileSystemDirectoryHandle ? found : undefined;
  }

  /** Stops keeping the handle under the key or use; none there is not a failure. */
  async forget(key: string): Promise<void> {
    const transaction = (await this.#database.open()).transaction(HANDLE_STORE, 'readwrite');
    const done = committed(transaction, 'Forgetting a file handle');
    transaction.objectStore(HANDLE_STORE).delete(key);
    await done;
  }

  async #found(key: string): Promise<unknown> {
    const transaction = (await this.#database.open()).transaction(HANDLE_STORE, 'readonly');
    return await settled(transaction.objectStore(HANDLE_STORE).get(key), 'Finding a handle');
  }
}
