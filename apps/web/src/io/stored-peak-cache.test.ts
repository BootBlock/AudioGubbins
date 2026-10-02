import { describe, expect, it } from 'vitest';

import { webDigest } from '@audiogubbins/browser-storage';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { CacheCategory, type CacheStore } from '@audiogubbins/storage';
import { connectStorage } from '@audiogubbins/storage-runtime';
import { portPair, serveMemoryStorage, steppingClock } from '@audiogubbins/storage-runtime/testing';
import type { PeakCacheStore } from '@audiogubbins/waveform';

import { storedPeakCache } from './stored-peak-cache.js';

const digest = webDigest(crypto.subtle);

/**
 * A cache kept by a storage worker over storage in memory, whose root is ready
 * until the test says otherwise, and the worker's caches as another window of
 * the profile reads them.
 */
function cacheOver() {
  const pair = portPair();
  const { another } = serveMemoryStorage(pair.worker);
  const client = connectStorage(
    pair.page,
    createDiagnosticCentre(createLogStore(), steppingClock()),
  );
  const root = { ready: true };
  const cache = storedPeakCache({ ready: () => root.ready, caches: client.caches, digest });
  return { cache, caches: another.caches, root };
}

/**
 * The bytes the cache gives back, as numbers: they crossed from the worker in a
 * structured clone, which under this environment makes them in another realm,
 * so they are no instance of the test's own `Uint8Array`.
 */
async function keptBytes(
  cache: PeakCacheStore,
  identity: string,
  revision: string,
): Promise<number[] | undefined> {
  const kept = await cache.read(identity, revision);
  if (kept !== undefined && !ArrayBuffer.isView(kept)) throw new Error('The cache gave no bytes.');
  return kept === undefined ? undefined : Array.from(kept);
}

/** The bytes of every waveform cache kept, in path order. */
async function waveformBytes(caches: CacheStore): Promise<number[]> {
  const sizes: number[] = [];
  for await (const entry of caches.entries(CacheCategory.Waveform)) sizes.push(entry.byteLength);
  return sizes;
}

describe('waveform peaks kept in the storage (ADR-0043, REQ-STOR-027)', () => {
  it('gives back the peaks kept for a source and revision, and nothing for another', async () => {
    const { cache } = cacheOver();
    await cache.write('picture-sound:take/1.webm:2048:7', 'a1b2c3d4', new Uint8Array([1, 2, 3]));

    expect(await keptBytes(cache, 'picture-sound:take/1.webm:2048:7', 'a1b2c3d4')).toEqual([
      1, 2, 3,
    ]);
    expect(await cache.read('picture-sound:take/1.webm:2048:7', 'ffffffff')).toBeUndefined();
    expect(await cache.read('test:tone-bursts', 'a1b2c3d4')).toBeUndefined();
  });

  it('leaves the bytes it is handed as they were, since the worker is sent a copy', async () => {
    const { cache } = cacheOver();
    const bytes = new Uint8Array([1, 2, 3]);
    await cache.write('test:loop', 'r1', bytes);

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps one revision of a source, so a newer one replaces the older', async () => {
    const { cache, caches } = cacheOver();
    await cache.write('test:tone-bursts', 'old', new Uint8Array(10));
    await cache.write('test:tone-bursts', 'new', new Uint8Array(20));
    await cache.write('test:loop', 'old', new Uint8Array(30));

    expect(await cache.read('test:tone-bursts', 'old')).toBeUndefined();
    expect(await keptBytes(cache, 'test:tone-bursts', 'new')).toEqual(Array<number>(20).fill(0));
    expect((await waveformBytes(caches)).toSorted((one, other) => one - other)).toEqual([20, 30]);
  });

  it('is counted and given up with the waveform caches, and made again after', async () => {
    const { cache, caches } = cacheOver();
    await cache.write('test:loop', 'r1', new Uint8Array(64));
    const usage = await caches.usage();
    if (!usage.ok) throw new Error('No usage.');
    // The peaks and the seal beside them.
    expect(usage.value.get(CacheCategory.Waveform)).toBeGreaterThan(64);

    expect(await caches.evictCategory(CacheCategory.Waveform)).toEqual({
      ok: true,
      value: usage.value.get(CacheCategory.Waveform),
    });
    expect(await cache.read('test:loop', 'r1')).toBeUndefined();
  });

  it('reads nothing from, and refuses to write into, storage that is not ready', async () => {
    // Stored data of another schema waits for the person's decision, and
    // nothing is written into it meanwhile; the peaks are made again.
    const { cache, caches, root } = cacheOver();
    await cache.write('test:loop', 'r1', new Uint8Array(8));
    root.ready = false;

    expect(await cache.read('test:loop', 'r1')).toBeUndefined();
    await expect(cache.write('test:loop', 'r2', new Uint8Array(8))).rejects.toThrow(
      'The stored data cannot be written to now, so these waveform peaks are not kept.',
    );
    root.ready = true;
    expect(await keptBytes(cache, 'test:loop', 'r1')).toEqual(Array<number>(8).fill(0));
    expect(await waveformBytes(caches)).toEqual([8]);
  });
});
