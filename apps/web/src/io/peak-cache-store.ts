/**
 * Where finished waveform peaks are kept between visits: the waveform
 * package's `PeakCacheStore`, over the browser's IndexedDB (ADR-0043).
 *
 * A disposable cache, never the only copy of anything (REQ-STOR-106): each
 * source keeps the bytes of its latest revision under its identity, so a new
 * revision replaces the old rather than accumulating beside it, and the peak
 * worker checks whatever is read before it is used. It is the application's
 * own database until Phase 02's cache store is on the branch, whose waveform
 * category then takes this port's place. A browser without IndexedDB keeps
 * nothing, which the Capabilities panel says (`WAVEFORM_CACHE`).
 */

import type { PeakCacheStore } from '@audiogubbins/waveform';

/** The database and the object store the peaks are kept in. */
const DATABASE = 'audiogubbins-cache';
const VERSION = 1;
const PEAKS = 'waveform-peaks';

/** A request of the database: its answer, or its error, said by an event. */
export interface Requested<T> extends EventTarget {
  readonly result: T;
  readonly error: DOMException | null;
}

/**
 * The part of an IndexedDB transaction the cache uses: its store, and the
 * `complete`, `abort` and `error` events that say whether it was kept.
 */
export interface PeakTransaction extends EventTarget {
  readonly error: DOMException | null;
  objectStore(name: string): {
    get(key: string): Requested<unknown>;
    put(value: unknown, key: string): Requested<unknown>;
  };
}

/**
 * The part of an IndexedDB database the cache uses, with the `close` and
 * `versionchange` events that end a connection.
 */
export interface PeakDatabase extends EventTarget {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(name: string, mode: 'readonly' | 'readwrite'): PeakTransaction;
  close(): void;
}

/** The part of IndexedDB's factory the cache uses; the browser's `indexedDB` is one. */
export interface PeakDatabaseFactory {
  open(name: string, version: number): Requested<PeakDatabase>;
}

interface KeptPeaks {
  readonly revision: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

function isKept(value: unknown): value is KeptPeaks {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'revision') === 'string' &&
    Reflect.get(value, 'bytes') instanceof Uint8Array
  );
}

/** A request's result, or its error, as a promise. */
function settled<T>(request: Requested<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('The waveform cache did not answer.'));
    });
  });
}

/**
 * Whether a transaction's writes were kept: a request succeeds before its
 * transaction commits, and the commit can still fail, over the quota for one.
 */
function committed(transaction: PeakTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const refused = (): void => {
      reject(transaction.error ?? new Error('The waveform cache did not keep the peaks.'));
    };
    transaction.addEventListener('complete', () => {
      resolve();
    });
    transaction.addEventListener('abort', refused);
    transaction.addEventListener('error', refused);
  });
}

/**
 * The database, opened once and shared by every read and write after it, and
 * opened again once the browser closes it, as it does when the site's data is
 * cleared or another page upgrades it.
 */
function opener(factory: PeakDatabaseFactory): () => Promise<PeakDatabase> {
  let opening: Promise<PeakDatabase> | undefined;
  return () => {
    if (opening !== undefined) return opening;
    const request = factory.open(DATABASE, VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(PEAKS)) {
        request.result.createObjectStore(PEAKS);
      }
    });
    const attempt = settled(request);
    opening = attempt;
    const forget = (): void => {
      if (opening === attempt) opening = undefined;
    };
    attempt.then(
      (database) => {
        database.addEventListener('close', forget);
        database.addEventListener('versionchange', () => {
          database.close();
          forget();
        });
      },
      // A database the browser would not open this time may open the next.
      forget,
    );
    return attempt;
  };
}

/** Keeps peaks in IndexedDB. */
export function indexedDbPeakCache(factory: PeakDatabaseFactory): PeakCacheStore {
  const database = opener(factory);
  return {
    async read(identity, revision) {
      const store = (await database()).transaction(PEAKS, 'readonly').objectStore(PEAKS);
      const kept = await settled(store.get(identity));
      return isKept(kept) && kept.revision === revision ? kept.bytes : undefined;
    },
    async write(identity, revision, bytes) {
      const transaction = (await database()).transaction(PEAKS, 'readwrite');
      const kept: KeptPeaks = { revision, bytes };
      const done = committed(transaction);
      await settled(transaction.objectStore(PEAKS).put(kept, identity));
      await done;
    },
  };
}

/** Keeps nothing, for a browser without IndexedDB: every source's peaks are made afresh. */
export const NO_PEAK_CACHE: PeakCacheStore = {
  read: () => Promise.resolve(undefined),
  write: () => Promise.resolve(),
};
