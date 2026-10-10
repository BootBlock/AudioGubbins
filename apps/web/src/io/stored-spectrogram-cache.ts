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
 * beside the tiles names the revision they are of and when its latest job
 * opened. A tile of a revision whose job opened later clears the source's tiles
 * before it is kept, and one whose job opened earlier is refused, so a tile of
 * a revision an edit replaced, kept late by this window or another of the
 * profile, never clears the replacing revision's tiles. The worker checks
 * whatever is read before it is used, so a cache is never the only copy of
 * anything.
 *
 * Reads are made a few at a time (G4), however many tiles a view shows at once,
 * and a read no view waits on any longer is given up, waiting or under way.
 * Writes of one source are made one after another, so a revision's marker and
 * its tiles are never interleaved with another revision's, a bounded number of
 * them waiting, and a write whose job closed is given up, waiting or under way.
 * Nothing is read or written until the storage root is ready, as for peaks: a
 * write then is refused with the reason, which the host reports, keeping the
 * tile in memory.
 */

import { Cancelled, type CancellationSignal } from '@audiogubbins/domain';
import { hexOf, type Digest } from '@audiogubbins/project-format';
import {
  tileKeyText,
  type SpectralTileCache,
  type SpectralTileKey,
  type TileWriting,
} from '@audiogubbins/spectral-analysis';
import { CacheCategory, unstoredScope, type CacheKey } from '@audiogubbins/storage';
import type { CacheClient } from '@audiogubbins/storage-runtime';

import { withAbortSignal } from './abort-signals.js';

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

/** Why a tile is refused where a later revision's tiles are kept. */
const LATER_REVISION_KEPT =
  'The tiles of a later revision of this sound are kept, so this one is not.';

/**
 * Reads under way at once. A view shows a few tiles of each channel, and the
 * storage worker reads one file at a time, so more would only queue there,
 * out of reach of a view that stops waiting.
 */
const CONCURRENT_READS = 4;

/**
 * Writes of one source waiting behind the one under way. A view shows a few
 * tiles of each channel and the worker makes one at a time, so more than this
 * waiting means the storage has fallen behind the worker; the oldest are of
 * places the view has most likely left, so they are let go first.
 */
export const WAITING_WRITES = 32;

/** Why a waiting write is let go. */
const TOO_MANY_WAITING =
  'Too many spectrogram tiles of this sound were waiting to be kept, so the oldest was let go.';

/**
 * Keeps nothing, for a browser that keeps no projects and so has no storage to
 * keep caches in: every tile is made afresh, which the Capabilities panel says.
 */
export const NO_SPECTROGRAM_CACHE: SpectralTileCache = {
  read: () => Promise.resolve(undefined),
  write: () => Promise.resolve(),
};

/** Work waiting for a slot: what starts it, and what lets it go unstarted. */
interface Waiting {
  readonly given: () => void;
  readonly letGo: (reason: Error) => void;
}

/** How many may wait for a slot, and why the oldest is let go past that. */
interface Crowding {
  readonly most: number;
  readonly reason: string;
}

/**
 * At most `limit` pieces of work at once, the rest waiting in order, each
 * given up when its signal is, and the oldest let go past `crowding.most`.
 */
class Slots {
  readonly #limit: number;
  readonly #crowding: Crowding | undefined;
  #running = 0;
  readonly #waiting: Waiting[] = [];

  constructor(limit: number, crowding?: Crowding) {
    this.#limit = limit;
    this.#crowding = crowding;
  }

  /** Whether nothing is under way or waiting. */
  get idle(): boolean {
    return this.#running === 0 && this.#waiting.length === 0;
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
      const waiting: Waiting = {
        given: () => {
          signal.removeEventListener('abort', cancelled);
          resolve();
        },
        letGo: (reason) => {
          signal.removeEventListener('abort', cancelled);
          reject(reason);
        },
      };
      const cancelled = (): void => {
        const at = this.#waiting.indexOf(waiting);
        if (at >= 0) this.#waiting.splice(at, 1);
        reject(signal.reason instanceof Error ? signal.reason : new Cancelled());
      };
      if (signal.aborted) {
        cancelled();
        return;
      }
      if (this.#crowding !== undefined && this.#waiting.length >= this.#crowding.most) {
        this.#waiting.shift()?.letGo(new Error(this.#crowding.reason));
      }
      this.#waiting.push(waiting);
      signal.addEventListener('abort', cancelled, { once: true });
    });
  }

  #release(): void {
    const next = this.#waiting.shift();
    // The slot passes to the next waiting, so the count stays as it is.
    if (next === undefined) this.#running -= 1;
    else next.given();
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

/** Which revision a source's tiles are of, and when its latest job opened. */
interface RevisionMarker {
  readonly opened: number;
  readonly revision: string;
}

/** A marker as it is kept: when its job opened, a space, and the revision. */
function markerBytes({ opened, revision }: RevisionMarker): Uint8Array<ArrayBuffer> {
  return TEXT.encode(`${String(opened)} ${revision}`);
}

/** The marker kept, or `undefined` for none or for one that cannot be read, whose tiles are cleared. */
function markerOf(bytes: Uint8Array | undefined): RevisionMarker | undefined {
  if (bytes === undefined) return undefined;
  const text = WORDS.decode(bytes);
  const space = text.indexOf(' ');
  const opened = Number(text.slice(0, space));
  if (space <= 0 || !Number.isFinite(opened)) return undefined;
  return { opened, revision: text.slice(space + 1) };
}

/**
 * Keeps `bytes` for `key`, clearing the source's tiles first where they are of
 * another revision whose job opened no later, and refusing them where it
 * opened later.
 */
async function keepTile(
  { ready, caches, digest }: SpectrogramCacheServices,
  key: SpectralTileKey,
  bytes: Uint8Array<ArrayBuffer>,
  { opened, signal }: TileWriting,
): Promise<void> {
  if (!ready()) {
    throw new Error(
      'The stored data cannot be written to now, so this spectrogram tile is not kept.',
    );
  }
  const tile = await tileKeyOf(key, digest);
  const marker: CacheKey = { ...tile, name: REVISION_MARKER };
  const ours = markerBytes({ opened, revision: key.revision });
  await withAbortSignal(signal, async (abort) => {
    const read = await caches.read(marker, abort);
    if (!read.ok) throw new Error(read.failures[0].summary);
    const kept = markerOf(read.value);
    if (kept?.revision === key.revision) {
      // Dated by its latest job, so another revision whose job opened between
      // this revision's first job and this one cannot clear it.
      if (opened > kept.opened) {
        const dated = await caches.put(marker, ours, abort);
        if (!dated.ok) throw new Error(dated.failures[0].summary);
      }
    } else if (kept !== undefined && opened < kept.opened) {
      throw new Error(LATER_REVISION_KEPT);
    } else {
      const cleared = await caches.evictScope(CacheCategory.Spectrogram, tile.scope);
      if (!cleared.ok) throw new Error(cleared.failures[0].summary);
      const marked = await caches.put(marker, ours, abort);
      if (!marked.ok) throw new Error(marked.failures[0].summary);
    }
    // The client moves the buffer it is given to the worker; the bytes are the
    // page's, so a copy of them is what moves.
    const put = await caches.put(tile, bytes.slice(), abort);
    if (!put.ok) throw new Error(put.failures[0].summary);
  });
}

/** Keeps tiles in the storage's spectrogram caches. */
export function storedSpectrogramCache(services: SpectrogramCacheServices): SpectralTileCache {
  const { ready, caches, digest } = services;
  const reads = new Slots(CONCURRENT_READS);
  /** Each source's writes, one at a time, kept while any is under way or waiting. */
  const writes = new Map<string, Slots>();
  return {
    read: (key, signal) =>
      reads.run(signal, async () => {
        if (!ready()) return undefined;
        const name = await tileKeyOf(key, digest);
        const kept = await withAbortSignal(signal, (abort) => caches.read(name, abort));
        if (!kept.ok) throw new Error(kept.failures[0].summary);
        return kept.value;
      }),
    write: async (key, bytes, writing) => {
      const source =
        writes.get(key.identity) ??
        new Slots(1, { most: WAITING_WRITES, reason: TOO_MANY_WAITING });
      writes.set(key.identity, source);
      try {
        // A write that failed is reported by the host; the next is made regardless.
        await source.run(writing.signal, () => keepTile(services, key, bytes, writing));
      } finally {
        if (source.idle) writes.delete(key.identity);
      }
    },
  };
}
