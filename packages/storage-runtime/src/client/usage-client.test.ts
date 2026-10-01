import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { CacheCategory, openProject, type CacheKey } from '@audiogubbins/storage';

import { SETTINGS, memoryStorage, type MemoryStorage } from '../testing/memory-storage.js';

const KEY: CacheKey = {
  category: CacheCategory.Waveform,
  scope: { kind: 'unstored', source: 'c'.repeat(64) },
  name: 'peaks-1',
};

/** A storage holding one project and one waveform cache of 100 bytes. */
async function used(): Promise<MemoryStorage> {
  const storage = memoryStorage();
  expectSuccess(await storage.client.library.create({ name: 'Wind', settings: SETTINGS }));
  expectSuccess(await storage.client.caches.put(KEY, new Uint8Array(100)));
  return storage;
}

describe('the usage, asked of the storage worker', () => {
  it('measures the projects and the caches, the open ones taken as given', async () => {
    const { client, another } = await used();
    const [entry] = await client.library.list();
    if (entry?.kind !== 'project') throw new Error('The project was not listed.');
    const opened = expectSuccess(
      await openProject({ project: entry.header.id, access: 'read' }, another),
    );
    if (opened.kind !== 'read-only') throw new Error(`The project opened ${opened.kind}.`);
    const live = opened.view.getSnapshot().model.state;
    opened.view.close();

    const usage = expectSuccess(await client.usage.measure([live]));

    expect(usage.caches.get(CacheCategory.Waveform)).toBeGreaterThanOrEqual(100);
    expect(usage.recoveryCheckpoints).toBeGreaterThan(0);
    expect(usage.unreadable).toEqual([]);
  });

  it('plans a cleanup removing nothing, and carries it out as planned', async () => {
    const { client } = await used();
    const cached = expectSuccess(await client.usage.measure([])).caches.get(CacheCategory.Waveform);

    const plan = expectSuccess(
      await client.usage.planCleanup([{ kind: 'cache', category: CacheCategory.Waveform }]),
    );
    expect(plan.steps).toEqual([
      { kind: 'cache', category: CacheCategory.Waveform, bytes: cached, loses: 'nothing' },
    ]);
    expect(expectSuccess(await client.caches.read(KEY))).toHaveLength(100);

    const outcomes = expectSuccess(await client.usage.runCleanup(plan, undefined));

    expect(outcomes).toEqual([{ step: 'cache', freed: cached, busy: [] }]);
    expect(expectSuccess(await client.caches.read(KEY))).toBeUndefined();
  });

  it('gives every cache up under pressure, and nothing else', async () => {
    const { client } = await used();

    const relief = expectSuccess(await client.usage.relievePressure());

    expect(relief.total).toBeGreaterThanOrEqual(100);
    expect(relief.freed.get(CacheCategory.Waveform)).toBe(relief.total);
    expect(expectSuccess(await client.caches.read(KEY))).toBeUndefined();
    expect(await client.library.list()).toHaveLength(1);
  });
});
