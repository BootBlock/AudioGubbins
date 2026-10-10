/**
 * The IndexedDB database the browser keeps handles in (REQ-STOR-104,
 * REQ-STOR-105): the few members of IndexedDB the keepers use, which the
 * browser's own factory has, so a test drives them with a small fake; waiting
 * for a request or a transaction; and the database, opened once and kept. A
 * refusal becomes a `TreeFailure` of its kind (`platform-failures.ts`).
 */

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

const DATABASE = 'audiogubbins-file-handles';
const VERSION = 1;
/** The store every kept handle, and every record kept with one, is kept in. */
export const HANDLE_STORE = 'handles';

/** Why a request or a transaction failed, as the designed failure. */
function refusalOf(error: DOMException | null, what: string): Error {
  return error === null ? new Error(`${what} failed without saying why.`) : treeFailureOf(error);
}

/** The request's result once it succeeds. */
export function settled<Result>(request: HandleRequest<Result>, what: string): Promise<Result> {
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
export function committed(transaction: HandleTransaction, what: string): Promise<void> {
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

/** The database of kept handles, opened once and kept. */
export class HandleStore {
  readonly #factory: HandleDatabaseFactory;
  #database: Promise<HandleDatabase> | undefined;

  constructor(factory: HandleDatabaseFactory) {
    this.#factory = factory;
  }

  /**
   * The database, opened once and kept. A refusal is not kept, so the next call
   * asks again; and a newer version opened in another tab closes this
   * connection, as it must for that tab to proceed, and the next call opens
   * afresh.
   */
  open(): Promise<HandleDatabase> {
    this.#database ??= this.#connect().catch((error: unknown) => {
      this.#database = undefined;
      throw error;
    });
    return this.#database;
  }

  async #connect(): Promise<HandleDatabase> {
    const request = this.#factory.open(DATABASE, VERSION);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(HANDLE_STORE);
    });
    const database = await settled(request, 'Opening the kept file handles');
    database.addEventListener('versionchange', () => {
      database.close();
      this.#database = undefined;
    });
    return database;
  }
}
