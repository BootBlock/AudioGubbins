/**
 * The part of IndexedDB the file-handle keeper uses, held in memory.
 *
 * Faithful where the keeper depends on it: a request succeeds or fails on a
 * later task, never within its call; opening a database it has not seen at that
 * version upgrades it first; a store keeps a value by reference, as a clone of
 * a handle stays that handle; and a transaction completes only after its
 * requests, or aborts where one fails. A refusal of opening or of writing can
 * be injected, and another tab's newer version can be announced.
 */

import type { HandleDatabaseFactory } from '../file-handle-keeper.js';

/** The failures to inject. */
export interface MemoryDatabaseOptions {
  /** The refusal opening meets, where there is one. */
  readonly refuseOpen?: DOMException;

  /** The refusal a write meets, where there is one. */
  readonly refuseWrite?: DOMException;
}

const later = (work: () => void): void => {
  setTimeout(work, 0);
};

class MemoryRequest<Result> extends EventTarget {
  result: Result;
  error: DOMException | null = null;

  constructor(initial: Result) {
    super();
    this.result = initial;
  }

  succeed(result: Result): void {
    this.result = result;
    this.dispatchEvent(new Event('success'));
  }

  fail(error: DOMException): void {
    this.error = error;
    this.dispatchEvent(new Event('error'));
  }
}

class MemoryTransaction extends EventTarget {
  error: DOMException | null = null;
  readonly #stores: Map<string, Map<string, unknown>>;
  readonly #options: MemoryDatabaseOptions;
  #outstanding = 0;
  #failed = false;

  constructor(stores: Map<string, Map<string, unknown>>, options: MemoryDatabaseOptions) {
    super();
    this.#stores = stores;
    this.#options = options;
  }

  objectStore(name: string): {
    put(value: unknown, key: string): MemoryRequest<unknown>;
    get(key: string): MemoryRequest<unknown>;
    delete(key: string): MemoryRequest<unknown>;
  } {
    const store = this.#stores.get(name);
    if (store === undefined) throw new DOMException(`No store ${name}.`, 'NotFoundError');
    return {
      put: (value, key) =>
        this.#request(this.#options.refuseWrite, () => {
          store.set(key, value);
          return key;
        }),
      get: (key) => this.#request(undefined, () => store.get(key)),
      delete: (key) =>
        this.#request(this.#options.refuseWrite, () => {
          store.delete(key);
          return undefined;
        }),
    };
  }

  #request(refusal: DOMException | undefined, work: () => unknown): MemoryRequest<unknown> {
    const request = new MemoryRequest<unknown>(undefined);
    this.#outstanding += 1;
    later(() => {
      this.#outstanding -= 1;
      if (refusal === undefined) {
        request.succeed(work());
      } else {
        request.fail(refusal);
        this.#failed = true;
        this.error = refusal;
      }
      if (this.#outstanding === 0) {
        this.dispatchEvent(new Event(this.#failed ? 'abort' : 'complete'));
      }
    });
    return request;
  }
}

class MemoryDatabase extends EventTarget {
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly #options: MemoryDatabaseOptions;
  closed = false;

  constructor(options: MemoryDatabaseOptions) {
    super();
    this.#options = options;
  }

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  transaction(store: string): MemoryTransaction {
    if (this.closed) throw new DOMException('The database is closed.', 'InvalidStateError');
    if (!this.stores.has(store)) throw new DOMException(`No store ${store}.`, 'NotFoundError');
    return new MemoryTransaction(this.stores, this.#options);
  }

  close(): void {
    this.closed = true;
  }
}

/** IndexedDB in memory (see the module comment). */
export class MemoryDatabases implements HandleDatabaseFactory {
  readonly #databases = new Map<string, { version: number; database: MemoryDatabase }>();
  readonly #options: MemoryDatabaseOptions;

  /** How many times a database was opened. */
  opened = 0;

  constructor(options: MemoryDatabaseOptions = {}) {
    this.#options = options;
  }

  open(name: string, version: number): MemoryRequest<MemoryDatabase> {
    const known = this.#databases.get(name);
    const database = known?.database ?? new MemoryDatabase(this.#options);
    const request = new MemoryRequest(database);
    later(() => {
      if (this.#options.refuseOpen !== undefined) {
        request.fail(this.#options.refuseOpen);
        return;
      }
      if (known === undefined || known.version < version) {
        this.#databases.set(name, { version, database });
        request.dispatchEvent(new Event('upgradeneeded'));
      }
      this.opened += 1;
      database.closed = false;
      request.succeed(database);
    });
    return request;
  }

  /** What the named store holds, by key. */
  contents(name: string, store: string): ReadonlyMap<string, unknown> {
    return this.#databases.get(name)?.database.stores.get(store) ?? new Map();
  }

  /** Tells every open connection that another tab opened a newer version. */
  announceNewerVersion(name: string): void {
    this.#databases.get(name)?.database.dispatchEvent(new Event('versionchange'));
  }
}
