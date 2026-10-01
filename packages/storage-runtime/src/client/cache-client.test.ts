import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { CacheCategory, type CacheKey } from '@audiogubbins/storage';

import { memoryStorage } from '../testing/memory-storage.js';

const SCOPE = { kind: 'unstored', source: 'a'.repeat(64) } as const;
const KEY: CacheKey = { category: CacheCategory.Waveform, scope: SCOPE, name: 'peaks-1' };

describe('the caches, asked of the storage worker', () => {
  it('keeps the bytes given up, and reads them back whole', async () => {
    const { client } = memoryStorage();
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);

    expectSuccess(await client.caches.put(KEY, bytes));

    expect(bytes.byteLength).toBe(0);
    const read = expectSuccess(await client.caches.read(KEY));
    // Read by value: the clone is made in the test's own realm, not the page's.
    expect(Array.from(read ?? [])).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads nothing where nothing is kept', async () => {
    const { client } = memoryStorage();

    await expect(client.caches.read(KEY)).resolves.toEqual({ ok: true, value: undefined });
  });

  it('gives up every cache of a scope, and none of another', async () => {
    const { client } = memoryStorage();
    const other: CacheKey = { ...KEY, scope: { kind: 'unstored', source: 'b'.repeat(64) } };
    expectSuccess(await client.caches.put(KEY, Uint8Array.from([1])));
    expectSuccess(await client.caches.put({ ...KEY, name: 'peaks-2' }, Uint8Array.from([2])));
    expectSuccess(await client.caches.put(other, Uint8Array.from([3])));

    expectSuccess(await client.caches.evictScope(CacheCategory.Waveform, SCOPE));

    expect(expectSuccess(await client.caches.read(KEY))).toBeUndefined();
    expect(expectSuccess(await client.caches.read({ ...KEY, name: 'peaks-2' }))).toBeUndefined();
    expect(Array.from(expectSuccess(await client.caches.read(other)) ?? [])).toEqual([3]);
  });
});
