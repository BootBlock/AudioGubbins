import { describe, expect, it } from 'vitest';

import {
  indexedDbPeakCache,
  type PeakDatabase,
  type PeakDatabaseFactory,
  type PeakTransaction,
  type Requested,
} from './peak-cache-store.js';

/** A request that answers on the next turn, as a browser's does, or fails. */
class Request<T> extends EventTarget implements Requested<T> {
  #result: { readonly value: T } | undefined;
  readonly error: DOMException | null;

  constructor(answer: () => T, fails = false, before?: (request: Request<T>) => void) {
    super();
    this.error = fails ? new DOMException('Refused.', 'UnknownError') : null;
    setTimeout(() => {
      if (fails) {
        this.dispatchEvent(new Event('error'));
        return;
      }
      this.#result = { value: answer() };
      before?.(this);
      this.dispatchEvent(new Event('success'));
    }, 0);
  }

  get result(): T {
    if (this.#result === undefined) throw new Error('The request has not answered.');
    return this.#result.value;
  }
}

/** A transaction that commits, or aborts at its commit, once a request of it has answered. */
class Transaction extends EventTarget implements PeakTransaction {
  error: DOMException | null = null;
  readonly #store: Map<string, unknown>;
  readonly #abortsAtCommit: boolean;

  constructor(store: Map<string, unknown>, abortsAtCommit: boolean) {
    super();
    this.#store = store;
    this.#abortsAtCommit = abortsAtCommit;
  }

  objectStore() {
    const store = this.#store;
    const commit = (): void => {
      this.#commit();
    };
    return {
      get: (key: string) => new Request(() => store.get(key), false, commit),
      put: (value: unknown, key: string) =>
        new Request(
          () => {
            if (!this.#abortsAtCommit) store.set(key, value);
            return key;
          },
          false,
          commit,
        ),
    };
  }

  #commit(): void {
    setTimeout(() => {
      if (this.#abortsAtCommit) {
        this.error = new DOMException('Over the quota.', 'QuotaExceededError');
        this.dispatchEvent(new Event('abort'));
      } else {
        this.dispatchEvent(new Event('complete'));
      }
    }, 0);
  }
}

/** The part of IndexedDB the cache uses, over a map of object stores. */
function fakeIndexedDb(
  options: { readonly refuseOpen?: boolean; readonly abortsAtCommit?: boolean } = {},
) {
  const stores = new Map<string, Map<string, unknown>>();
  let opens = 0;
  const database: PeakDatabase = Object.assign(new EventTarget(), {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => stores.set(name, new Map()),
    transaction: (name: string) =>
      new Transaction(
        stores.get(name) ?? new Map<string, unknown>(),
        options.abortsAtCommit === true,
      ),
    close: () => undefined,
  });
  const factory: PeakDatabaseFactory = {
    open: () => {
      opens += 1;
      // A new database is upgraded, which makes its stores, before it opens.
      return new Request(
        () => database,
        options.refuseOpen === true,
        (opening) => opening.dispatchEvent(new Event('upgradeneeded')),
      );
    },
  };
  return { factory, stores, database, opens: () => opens };
}

const bytes = (values: readonly number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values);

describe('the peak cache in IndexedDB', () => {
  it('reads back what it kept for the same revision, and nothing for another', async () => {
    const { factory } = fakeIndexedDb();
    const cache = indexedDbPeakCache(factory);

    await cache.write('test:tone-bursts', 'a1', bytes([1, 2, 3]));

    expect(await cache.read('test:tone-bursts', 'a1')).toEqual(bytes([1, 2, 3]));
    expect(await cache.read('test:tone-bursts', 'b2')).toBeUndefined();
    expect(await cache.read('test:loop', 'a1')).toBeUndefined();
  });

  it('keeps one revision of a source, the latest', async () => {
    const { factory, stores } = fakeIndexedDb();
    const cache = indexedDbPeakCache(factory);

    await cache.write('test:loop', 'a1', bytes([1]));
    await cache.write('test:loop', 'b2', bytes([2]));

    expect(stores.get('waveform-peaks')?.size).toBe(1);
    expect(await cache.read('test:loop', 'b2')).toEqual(bytes([2]));
  });

  it('opens the database once for every read and write after it', async () => {
    const { factory, opens } = fakeIndexedDb();
    const cache = indexedDbPeakCache(factory);

    await cache.write('one', 'a', bytes([1]));
    await cache.read('one', 'a');

    expect(opens()).toBe(1);
  });

  it('refuses where the browser will not open the database, and tries again next time', async () => {
    const { factory, opens } = fakeIndexedDb({ refuseOpen: true });
    const cache = indexedDbPeakCache(factory);

    await expect(cache.read('one', 'a')).rejects.toThrow('Refused.');
    await expect(cache.read('one', 'a')).rejects.toThrow('Refused.');
    expect(opens()).toBe(2);
  });

  it('refuses a write whose transaction does not commit, though its request succeeded', async () => {
    const { factory } = fakeIndexedDb({ abortsAtCommit: true });
    const cache = indexedDbPeakCache(factory);

    await expect(cache.write('one', 'a', bytes([1]))).rejects.toThrow('Over the quota.');
  });

  it('opens the database again once the browser has closed it', async () => {
    const { factory, database, opens } = fakeIndexedDb();
    const cache = indexedDbPeakCache(factory);
    await cache.write('one', 'a', bytes([1]));

    database.dispatchEvent(new Event('close'));
    await cache.read('one', 'a');

    expect(opens()).toBe(2);
  });
});
