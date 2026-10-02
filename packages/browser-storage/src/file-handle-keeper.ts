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
 * IndexedDB is reached through the few members this module uses, which the
 * browser's own factory has, so a test drives it with a small fake. A refusal
 * becomes a `TreeFailure` of its kind, the one failure every storage adapter
 * rejects with (`platform-failures.ts`).
 */

import type { TokenSource } from '@audiogubbins/media-store';
import { FOLDER_KEY_PREFIX } from '@audiogubbins/project-format';

import { treeFailureOf } from './platform-failures.js';

/** A request, as far as this module waits for one: `IDBRequest`. */
export interface HandleRequest<Result> {
  readonly result: Result;
  readonly error: DOMException | null;
  addEventListener(type: 'success' | 'error', listener: () => void): void;
}

/** The request that opens the database: `IDBOpenDBRequest`. */
export interface HandleOpenRequest extends HandleRequest<HandleDatabase> {
  addEventListener(type: 'success' | 'error' | 'upgradeneeded', listener: () => void): void;
}

/** An object store: `IDBObjectStore`. */
export interface HandleObjectStore {
  put(value: unknown, key: string): HandleRequest<unknown>;
  get(key: string): HandleRequest<unknown>;
  delete(key: string): HandleRequest<unknown>;
}

/** A transaction: `IDBTransaction`. */
export interface HandleTransaction {
  readonly error: DOMException | null;
  objectStore(name: string): HandleObjectStore;
  addEventListener(type: 'complete' | 'error' | 'abort', listener: () => void): void;
}

/** An open database: `IDBDatabase`. */
export interface HandleDatabase {
  createObjectStore(name: string): unknown;
  transaction(store: string, mode: IDBTransactionMode): HandleTransaction;
  close(): void;
  addEventListener(type: 'versionchange', listener: () => void): void;
}

/** What the keeper opens its database through: the browser's `IDBFactory`. */
export interface HandleDatabaseFactory {
  open(name: string, version: number): HandleOpenRequest;
}

/** What a kept folder is for, and the key it is kept under. */
export const FolderUse = {
  /** The folder each backup of a project is copied to (REQ-STOR-105). */
  Backups: `${FOLDER_KEY_PREFIX}backups`,
} as const;

/** What a kept folder is for, and the key it is kept under. */
export type FolderUse = (typeof FolderUse)[keyof typeof FolderUse];

const DATABASE = 'audiogubbins-file-handles';
const VERSION = 1;
const STORE = 'handles';

/** Why a request or a transaction failed, as the designed failure. */
function refusalOf(error: DOMException | null, what: string): Error {
  return error === null ? new Error(`${what} failed without saying why.`) : treeFailureOf(error);
}

/** The request's result once it succeeds. */
function settled<Result>(request: HandleRequest<Result>, what: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(refusalOf(request.error, what));
    });
  });
}

/** Resolves once the transaction is durable, rejecting where it is not. */
function committed(transaction: HandleTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => {
      resolve();
    });
    const fail = (): void => {
      reject(refusalOf(transaction.error, what));
    };
    transaction.addEventListener('error', fail);
    transaction.addEventListener('abort', fail);
  });
}

/** The kept handles of linked files and chosen folders (see the module comment). */
export class FileHandleKeeper {
  readonly #factory: HandleDatabaseFactory;
  readonly #nextToken: TokenSource;
  #database: Promise<HandleDatabase> | undefined;

  constructor(factory: HandleDatabaseFactory, nextToken: TokenSource) {
    this.#factory = factory;
    this.#nextToken = nextToken;
  }

  /** Keeps a handle, and answers the key it is kept under. */
  async keep(handle: FileSystemFileHandle): Promise<string> {
    const key = this.#nextToken();
    const transaction = (await this.#open()).transaction(STORE, 'readwrite');
    const done = committed(transaction, 'Keeping a file handle');
    transaction.objectStore(STORE).put(handle, key);
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
    const transaction = (await this.#open()).transaction(STORE, 'readwrite');
    const done = committed(transaction, 'Keeping a folder handle');
    transaction.objectStore(STORE).put(folder, use);
    await done;
  }

  /** The folder kept for a use, or `undefined` where none is. */
  async findFolder(use: FolderUse): Promise<FileSystemDirectoryHandle | undefined> {
    const found = await this.#found(use);
    return found instanceof FileSystemDirectoryHandle ? found : undefined;
  }

  /** Stops keeping the handle under the key or use; none there is not a failure. */
  async forget(key: string): Promise<void> {
    const transaction = (await this.#open()).transaction(STORE, 'readwrite');
    const done = committed(transaction, 'Forgetting a file handle');
    transaction.objectStore(STORE).delete(key);
    await done;
  }

  async #found(key: string): Promise<unknown> {
    const transaction = (await this.#open()).transaction(STORE, 'readonly');
    return await settled(transaction.objectStore(STORE).get(key), 'Finding a handle');
  }

  /**
   * The database, opened once and kept. A refusal is not kept, so the next call
   * asks again; and a newer version opened in another tab closes this
   * connection, as it must for that tab to proceed, and the next call opens
   * afresh.
   */
  #open(): Promise<HandleDatabase> {
    this.#database ??= this.#connect().catch((error: unknown) => {
      this.#database = undefined;
      throw error;
    });
    return this.#database;
  }

  async #connect(): Promise<HandleDatabase> {
    const request = this.#factory.open(DATABASE, VERSION);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(STORE);
    });
    const database = await settled(request, 'Opening the kept file handles');
    database.addEventListener('versionchange', () => {
      database.close();
      this.#database = undefined;
    });
    return database;
  }
}
