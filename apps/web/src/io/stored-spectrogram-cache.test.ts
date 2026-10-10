import { describe, expect, it } from 'vitest';

import { webDigest } from '@audiogubbins/browser-storage';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { createCancellationSource } from '@audiogubbins/domain';
import { DEFAULT_SPECTROGRAM_CONFIG, type SpectralTileKey } from '@audiogubbins/spectral-analysis';
import { CacheCategory, type CacheStore } from '@audiogubbins/storage';
import { connectStorage, type CacheClient } from '@audiogubbins/storage-runtime';
import { portPair, serveMemoryStorage, steppingClock } from '@audiogubbins/storage-runtime/testing';

import { storedSpectrogramCache } from './stored-spectrogram-cache.js';

const digest = webDigest(crypto.subtle);

/**
 * A cache kept by a storage worker over storage in memory, whose root is ready
 * until the test says otherwise, the worker's caches as another window of the
 * profile reads them, and the most reads the page had under way at once.
 */
function cacheOver() {
  const pair = portPair();
  const { another } = serveMemoryStorage(pair.worker);
  const client = connectStorage(
    pair.page,
    createDiagnosticCentre(createLogStore(), steppingClock()),
  );
  const root = { ready: true };
  const reads = { now: 0, most: 0, started: 0 };
  const counted: CacheClient = {
    ...client.caches,
    read: async (key, signal) => {
      reads.now += 1;
      reads.started += 1;
      reads.most = Math.max(reads.most, reads.now);
      try {
        return await client.caches.read(key, signal);
      } finally {
        reads.now -= 1;
      }
    },
  };
  const cache = storedSpectrogramCache({ ready: () => root.ready, caches: counted, digest });
  return { cache, caches: another.caches, root, reads };
}

function key(index: number, revision = 'r1', identity = 'test:tone-bursts'): SpectralTileKey {
  return { identity, revision, channel: 0, config: DEFAULT_SPECTROGRAM_CONFIG, level: 0, index };
}

const NEVER = createCancellationSource().signal;

/** The bytes kept for `tile`, as numbers, or `undefined`: they crossed from the worker in another realm. */
async function keptBytes(
  cache: ReturnType<typeof cacheOver>['cache'],
  tile: SpectralTileKey,
): Promise<number[] | undefined> {
  const kept = await cache.read(tile, NEVER);
  if (kept !== undefined && !ArrayBuffer.isView(kept)) throw new Error('The cache gave no bytes.');
  return kept === undefined ? undefined : Array.from(kept);
}

/** The sizes of every spectrogram cache kept, smallest first. */
async function spectrogramSizes(caches: CacheStore): Promise<number[]> {
  const sizes: number[] = [];
  for await (const entry of caches.entries(CacheCategory.Spectrogram)) sizes.push(entry.byteLength);
  return sizes.toSorted((one, other) => one - other);
}

describe('spectrogram tiles kept in the storage (ADR-0080, REQ-STOR-027)', () => {
  it('gives back each tile kept, and nothing for another tile, revision or source', async () => {
    const { cache } = cacheOver();
    await cache.write(key(0), new Uint8Array([1, 2, 3]));
    await cache.write(key(1), new Uint8Array([4, 5]));

    expect(await keptBytes(cache, key(0))).toEqual([1, 2, 3]);
    expect(await keptBytes(cache, key(1))).toEqual([4, 5]);
    expect(await cache.read(key(2), NEVER)).toBeUndefined();
    expect(await cache.read(key(0, 'r2'), NEVER)).toBeUndefined();
    expect(await cache.read(key(0, 'r1', 'test:loop'), NEVER)).toBeUndefined();
    expect(await cache.read({ ...key(0), channel: 1 }, NEVER)).toBeUndefined();
  });

  it('leaves the bytes it is handed as they were, since the worker is sent a copy', async () => {
    const { cache } = cacheOver();
    const bytes = new Uint8Array([1, 2, 3]);
    await cache.write(key(0), bytes);

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps one revision of a source, letting go of its other revisions’ tiles', async () => {
    const { cache, caches } = cacheOver();
    await cache.write(key(0, 'old'), new Uint8Array(10));
    await cache.write(key(1, 'old'), new Uint8Array(11));
    await cache.write(key(0, 'r1', 'test:loop'), new Uint8Array(30));
    // Written together, as a host keeps the tiles the worker makes.
    await Promise.all([
      cache.write(key(0, 'new'), new Uint8Array(20)),
      cache.write(key(1, 'new'), new Uint8Array(21)),
    ]);

    expect(await cache.read(key(0, 'old'), NEVER)).toBeUndefined();
    expect(await cache.read(key(1, 'old'), NEVER)).toBeUndefined();
    expect(await keptBytes(cache, key(0, 'new'))).toEqual(Array<number>(20).fill(0));
    expect(await keptBytes(cache, key(1, 'new'))).toEqual(Array<number>(21).fill(0));
    // Each source's marker is its revision's name: three bytes and two.
    expect(await spectrogramSizes(caches)).toEqual([2, 3, 20, 21, 30]);
  });

  it('reads a few tiles at a time however many are asked for, and gives up a read no view waits on', async () => {
    const { cache, reads } = cacheOver();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => cache.write(key(index), new Uint8Array([index]))),
    );
    const left = createCancellationSource();
    const asked = Array.from({ length: 8 }, (_, index) =>
      cache.read(key(index), index === 7 ? left.signal : NEVER),
    );
    left.cancel(new Error('No view shows the tile.'));
    reads.most = 0;
    reads.started = 0;

    const read = await Promise.allSettled(asked);
    expect(reads.most).toBeLessThanOrEqual(4);
    expect(read.at(-1)).toEqual({
      status: 'rejected',
      reason: new Error('No view shows the tile.'),
    });
    // The read given up while it waited was never begun.
    expect(reads.started).toBe(7);
    for (const [index, each] of read.slice(0, 7).entries()) {
      expect(each.status === 'fulfilled' ? Array.from(each.value ?? []) : undefined).toEqual([
        index,
      ]);
    }
  });

  it('is counted and given up with the spectrogram caches, and made again after', async () => {
    const { cache, caches } = cacheOver();
    await cache.write(key(0), new Uint8Array(64));
    const usage = await caches.usage();
    if (!usage.ok) throw new Error('No usage.');
    expect(usage.value.get(CacheCategory.Spectrogram)).toBeGreaterThan(64);

    await caches.evictCategory(CacheCategory.Spectrogram);
    expect(await cache.read(key(0), NEVER)).toBeUndefined();
    await cache.write(key(0), new Uint8Array(4));
    expect(await keptBytes(cache, key(0))).toEqual([0, 0, 0, 0]);
  });

  it('reads nothing from, and refuses to write into, storage that is not ready', async () => {
    const { cache, caches, root } = cacheOver();
    await cache.write(key(0), new Uint8Array(8));
    root.ready = false;

    expect(await cache.read(key(0), NEVER)).toBeUndefined();
    await expect(cache.write(key(0, 'r2'), new Uint8Array(8))).rejects.toThrow(
      'The stored data cannot be written to now, so this spectrogram tile is not kept.',
    );
    // A refused write does not hold up the next.
    root.ready = true;
    await cache.write(key(1), new Uint8Array(9));
    expect(await keptBytes(cache, key(0))).toEqual(Array<number>(8).fill(0));
    expect(await spectrogramSizes(caches)).toEqual([2, 8, 9]);
  });
});
