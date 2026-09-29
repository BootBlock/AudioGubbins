import { describe, expect, it } from 'vitest';

import {
  indexedDbPeakCache,
  type PeakDatabase,
  type PeakDatabaseFactory,
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

/** The part of IndexedDB the cache uses, over a map of object stores. */
function fakeIndexedDb(options: { readonly refuseOpen?: boolean } = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  let opens = 0;
  const database: PeakDatabase = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => stores.set(name, new Map()),
    transaction: (name) => ({
      objectStore: () => {
        const store = stores.get(name) ?? new Map<string, unknown>();
        return {
          get: (key) => new Request(() => store.get(key)),
          put: (value, key) =>
            new Request(() => {
              store.set(key, value);
              return key;
            }),
        };
      },
    }),
  };
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
  return { factory, stores, opens: () => opens };
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
});
