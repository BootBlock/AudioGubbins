/**
 * Where spectrogram tiles are kept between visits: the spectral-analysis
 * package's `SpectralTileCache`, over the storage's spectrogram caches
 * (ADR-0080, REQ-STOR-027).
 *
 * Kept beside everything else the storage keeps, tiles are counted among the
 * caches the Storage panel shows and given up in the order storage pressure
 * gives caches up, spectrograms before intermediates (REQ-STOR-106). The
 * sources the editor opens may be audio the storage does not keep, so each
 * source's tiles are kept under the digest of its identity, each tile named by
 * the digest of its whole key, and one revision of a source at a time: a marker
 * beside the tiles names the revision they are of, and a tile of another
 * revision clears the source's tiles before it is kept. The worker checks
 * whatever is read before it is used, so a cache is never the only copy of
 * anything.
 *
 * Reads are made a few at a time (G4), however many tiles a view shows at once,
 * and a read no view waits on any longer is given up, waiting or under way.
 * Writes of one source are made one after another, so a revision's marker and
 * its tiles are never interleaved with another revision's. Nothing is read or
 * written until the storage root is ready, as for peaks: a write then is
 * refused with the reason, which the host reports, keeping the tile in memory.
 */

import { Cancelled, type CancellationSignal } from '@audiogubbins/domain';
import { hexOf, type Digest } from '@audiogubbins/project-format';
import {
  tileKeyText,
  type SpectralTileCache,
  type SpectralTileKey,
} from '@audiogubbins/spectral-analysis';
import { CacheCategory, unstoredScope, type CacheKey } from '@audiogubbins/storage';
import type { CacheClient } from '@audiogubbins/storage-runtime';

import { abortSignalOf } from './abort-signals.js';

/** What the tiles are kept with. */
export interface SpectrogramCacheServices {
  /** Whether the storage root is open and of this build's schema, so caches may be kept. */
  readonly ready: () => boolean;
  readonly caches: CacheClient;
  readonly digest: Digest;
}

const TEXT = new TextEncoder();
const WORDS = new TextDecoder();

/** How much of a key's digest names its tile: plenty to tell tiles apart. */
const NAME_DIGITS = 32;

/** The name of the marker that says which revision a source's tiles are of. */
const REVISION_MARKER = 'revision';

/**
 * Reads under way at once. A view shows a few tiles of each channel, and the
 * storage worker reads one file at a time, so more would only queue there,
 * out of reach of a view that stops waiting.
 */
const CONCURRENT_READS = 4;

/**
 * Keeps nothing, for a browser that keeps no projects and so has no storage to
 * keep caches in: every tile is made afresh, which the Capabilities panel says.
 */
export const NO_SPECTROGRAM_CACHE: SpectralTileCache = {
  read: () => Promise.resolve(undefined),
  write: () => Promise.resolve(),
};

/** At most `limit` pieces of work at once, the rest waiting in order, each given up when its signal is. */
class Slots {
  readonly #limit: number;
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  /** Runs `work` once a slot is free, or fails with the signal's reason if it is cancelled first. */
  async run<T>(signal: CancellationSignal, work: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#limit) await this.#slot(signal);
    else this.#running += 1;
    try {
      return await work();
    } finally {
      this.#release();
    }
  }

  /** Waits for a slot, which the work that frees it hands on. */
  #slot(signal: CancellationSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const given = (): void => {
        signal.removeEventListener('abort', cancelled);
        resolve();
      };
      const cancelled = (): void => {
        const at = this.#waiting.indexOf(given);
        if (at >= 0) this.#waiting.splice(at, 1);
        reject(signal.reason instanceof Error ? signal.reason : new Cancelled());
      };
      if (signal.aborted) {
        cancelled();
        return;
      }
      this.#waiting.push(given);
      signal.addEventListener('abort', cancelled, { once: true });
    });
  }

  #release(): void {
    const next = this.#waiting.shift();
    // The slot passes to the next waiting, so the count stays as it is.
    if (next === undefined) this.#running -= 1;
    else next();
  }
}

/** Where `key`'s tile is kept, under the digest of its source and of its whole key. */
async function tileKeyOf(key: SpectralTileKey, digest: Digest): Promise<CacheKey> {
  const hash = await digest(TEXT.encode(tileKeyText(key)));
  return {
    category: CacheCategory.Spectrogram,
    scope: await unstoredScope(key.identity, digest),
    name: `tile-${hexOf(hash).slice(0, NAME_DIGITS)}`,
  };
}

/** Keeps `bytes` for `key`, clearing the source's tiles first where they are of another revision. */
async function keepTile(
  { ready, caches, digest }: SpectrogramCacheServices,
  key: SpectralTileKey,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  if (!ready()) {
    throw new Error(
      'The stored data cannot be written to now, so this spectrogram tile is not kept.',
    );
  }
  const tile = await tileKeyOf(key, digest);
  const marker: CacheKey = { ...tile, name: REVISION_MARKER };
  const kept = await caches.read(marker);
  if (!kept.ok) throw new Error(kept.failures[0].summary);
  if (kept.value === undefined || WORDS.decode(kept.value) !== key.revision) {
    const cleared = await caches.evictScope(CacheCategory.Spectrogram, tile.scope);
    if (!cleared.ok) throw new Error(cleared.failures[0].summary);
    const marked = await caches.put(marker, TEXT.encode(key.revision));
    if (!marked.ok) throw new Error(marked.failures[0].summary);
  }
  // The client moves the buffer it is given to the worker; the bytes are the
  // page's, so a copy of them is what moves.
  const put = await caches.put(tile, bytes.slice());
  if (!put.ok) throw new Error(put.failures[0].summary);
}

/** Keeps tiles in the storage's spectrogram caches. */
export function storedSpectrogramCache(services: SpectrogramCacheServices): SpectralTileCache {
  const { ready, caches, digest } = services;
  const reads = new Slots(CONCURRENT_READS);
  /** The last write of each source, which the next waits for. */
  const writing = new Map<string, Promise<void>>();
  return {
    read: (key, signal) =>
      reads.run(signal, async () => {
        if (!ready()) return undefined;
        const kept = await caches.read(await tileKeyOf(key, digest), abortSignalOf(signal));
        if (!kept.ok) throw new Error(kept.failures[0].summary);
        return kept.value;
      }),
    write: (key, bytes) => {
      const before = writing.get(key.identity) ?? Promise.resolve();
      // A write that failed is reported by the host; the next is made regardless.
      const after = before.catch(() => undefined).then(() => keepTile(services, key, bytes));
      writing.set(key.identity, after);
      const settled = (): void => {
        if (writing.get(key.identity) === after) writing.delete(key.identity);
      };
      void after.then(settled, settled);
      return after;
    },
  };
}
