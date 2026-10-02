import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, generatedSource } from '@audiogubbins/media-store/testing';

import {
  CACHE_CLEANUP_ORDER,
  CacheCategory,
  CacheStore,
  cacheKeyOf,
  cachePathOf,
  unstoredScope,
  type CacheKey,
} from './cache-store.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { contentOf } from './testing/test-commands.js';
import { nodeDigest } from './testing/node-services.js';

/**
 * Caches are disposable (REQ-STOR-027): one kept whole reads back, one torn or
 * unsealed reads as absent rather than as data, and giving a category up frees
 * what it held and nothing else.
 */

const PEAKS: CacheKey = {
  category: CacheCategory.Waveform,
  scope: { kind: 'media', content: contentOf(1) },
  name: 'peaks-256',
};

async function bytesOf(store: CacheStore, key: CacheKey): Promise<Uint8Array | undefined> {
  const source = expectSuccess(await store.open(key));
  return source === undefined ? undefined : await source.read(0, source.size);
}

describe('the cache store (REQ-STOR-027, REQ-STOR-106)', () => {
  it('keeps a cache, streamed in, and gives it back', async () => {
    const store = new CacheStore(new MemoryStorageTree(), nodeDigest);
    const source = generatedSource(2 * 1_048_576 + 5, 9);
    expectSuccess(await store.put(PEAKS, source));
    expect(source.largestRead).toBeLessThanOrEqual(1_048_576);
    // Compared as bytes: a deep equality walks two megabytes an element at a time.
    const kept = await bytesOf(store, PEAKS);
    expect(kept && Buffer.compare(kept, await source.read(0, source.size))).toBe(0);
  });

  it('reads a cache torn or without its seal as absent', async () => {
    const tree = new MemoryStorageTree();
    const store = new CacheStore(tree, nodeDigest);
    expectSuccess(await store.put(PEAKS, new Uint8Array([1, 2, 3, 4])));
    const path = `cache/${cachePathOf(PEAKS)}`;

    await tree.writeFile(path, new Uint8Array([1, 2]));
    expect(await bytesOf(store, PEAKS)).toBeUndefined();

    expectSuccess(await store.put(PEAKS, new Uint8Array([5, 6])));
    await tree.remove(`${path}.seal`);
    expect(await bytesOf(store, PEAKS)).toBeUndefined();
  });

  it('reads a cache whose replacement a crash cut short as the old, the new or absent', async () => {
    const from = new MemoryStorageTree();
    expectSuccess(await new CacheStore(from, nodeDigest).put(PEAKS, new Uint8Array(8)));
    const replacement = new Uint8Array(8).fill(7);
    await sweepCrashes({
      from,
      tornWrites: ['short', 'full-length'],
      run: async (tree) => await new CacheStore(tree, nodeDigest).put(PEAKS, replacement),
      check: async (found, { outcome }) => {
        const store = new CacheStore(found, nodeDigest);
        const read = await bytesOf(store, PEAKS);
        if (outcome !== undefined) expect(read).toEqual(replacement);
        // Never bytes torn between the two, read as either.
        else expect([undefined, new Uint8Array(8), replacement]).toContainEqual(read);
        expectSuccess(await store.put(PEAKS, new Uint8Array([1])));
        expect(await bytesOf(store, PEAKS)).toEqual(new Uint8Array([1]));
      },
    });
  });

  it('lists and measures each category, and gives one up without touching the others', async () => {
    const tree = new MemoryStorageTree();
    const store = new CacheStore(tree, nodeDigest);
    const render: CacheKey = {
      category: CacheCategory.Render,
      scope: { kind: 'project', project: unsafeBrandId('abcdef01-abcdef01-abcdef01-abcdef01') },
      name: 'preview',
    };
    expectSuccess(await store.put(PEAKS, new Uint8Array(10)));
    expectSuccess(await store.put(render, new Uint8Array(30)));

    const entries = [];
    for await (const entry of store.entries(CacheCategory.Waveform)) entries.push(entry);
    expect(entries).toEqual([{ key: PEAKS, byteLength: 10 }]);
    const usage = expectSuccess(await store.usage());
    expect(usage.get(CacheCategory.Render)).toBeGreaterThan(30);

    const freed = expectSuccess(await store.evictCategory(CacheCategory.Render));
    expect(freed).toBe(usage.get(CacheCategory.Render));
    expect(await bytesOf(store, render)).toBeUndefined();
    expect(await bytesOf(store, PEAKS)).toEqual(new Uint8Array(10));
  });

  it('keeps the caches of audio it does not store under a digest of its identity', async () => {
    // A built-in signal or a picture's sound has no content identifier and no
    // project, and its identity may hold any character a path may not.
    const store = new CacheStore(new MemoryStorageTree(), nodeDigest);
    const picture = await unstoredScope('picture-sound:take/1.webm:2048:7', nodeDigest);
    const tones = await unstoredScope('test:tone-bursts', nodeDigest);
    expect(picture).toEqual(await unstoredScope('picture-sound:take/1.webm:2048:7', nodeDigest));
    expect(picture).not.toEqual(tones);

    const key: CacheKey = { category: CacheCategory.Waveform, scope: picture, name: 'peaks' };
    expect(cacheKeyOf(cachePathOf(key))).toEqual(key);
    expectSuccess(await store.put(key, new Uint8Array([1, 2, 3])));
    expect(await bytesOf(store, key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await bytesOf(store, { ...key, scope: tones })).toBeUndefined();
  });

  it('gives up every cache of one scope in a category, and nothing else', async () => {
    const store = new CacheStore(new MemoryStorageTree(), nodeDigest);
    const tones = await unstoredScope('test:tone-bursts', nodeDigest);
    const older: CacheKey = { category: CacheCategory.Waveform, scope: tones, name: 'r-1' };
    const newer: CacheKey = { ...older, name: 'r-2' };
    const spectrum: CacheKey = { ...older, category: CacheCategory.Spectrogram };
    for (const key of [older, newer, spectrum, PEAKS]) {
      expectSuccess(await store.put(key, new Uint8Array(4)));
    }

    expectSuccess(await store.evictScope(CacheCategory.Waveform, tones));

    expect(await bytesOf(store, older)).toBeUndefined();
    expect(await bytesOf(store, newer)).toBeUndefined();
    expect(await bytesOf(store, spectrum)).toEqual(new Uint8Array(4));
    expect(await bytesOf(store, PEAKS)).toEqual(new Uint8Array(4));
  });

  it('names a cache by a path its key is read back from, and refuses other paths', async () => {
    expect(cacheKeyOf(cachePathOf(PEAKS))).toEqual(PEAKS);
    expect(cacheKeyOf('waveform/not-a-scope/peaks')).toBeUndefined();
    expect(cacheKeyOf(`waveform/u-${'a'.repeat(63)}/peaks`)).toBeUndefined();
    expect(cacheKeyOf(`waveform/u-${'A'.repeat(64)}/peaks`)).toBeUndefined();
    expect(cacheKeyOf(`unknown/${contentOf(1)}/peaks`)).toBeUndefined();
    expect(cacheKeyOf(`waveform/${contentOf(1)}/peaks.seal`)).toBeUndefined();
    expect(CACHE_CLEANUP_ORDER[0]).toBe(CacheCategory.Temporary);
    await expect(
      new CacheStore(new MemoryStorageTree(), nodeDigest).put(
        { ...PEAKS, name: 'a/b' },
        new Uint8Array(),
      ),
    ).rejects.toThrow();
  });
});
