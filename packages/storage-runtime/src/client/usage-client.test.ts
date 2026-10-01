import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  sampleCount,
  unsafeBrandId,
  type Asset,
  type ProjectId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { generatedSource } from '@audiogubbins/media-store/testing';
import { addAssetInvocation } from '@audiogubbins/project-commands';
import { storageKeyOf, type ManagedMedia } from '@audiogubbins/project-format';
import { CacheCategory, type CacheKey, type CleanupPlan } from '@audiogubbins/storage';

import type { RemoteProjectSession } from './remote-project.js';
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

/** The project the storage holds, open to write through the page's client. */
async function opened(storage: MemoryStorage): Promise<RemoteProjectSession> {
  const [entry] = await storage.client.library.list();
  if (entry?.kind !== 'project') throw new Error('The project was not listed.');
  const project = await storage.client.projects.open({ project: entry.header.id, access: 'write' });
  const value = expectSuccess(project);
  if (value.kind !== 'writable') throw new Error(`The project opened ${value.kind}.`);
  return value.session;
}

/** An asset whose bytes are `media`. */
function assetOf(media: ManagedMedia): Asset {
  const id = unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-000000000001');
  return {
    id,
    displayName: 'Rain',
    origin: AssetOrigin.Imported,
    sampleRate: SETTINGS.sampleRate,
    channelLayout: SETTINGS.channelLayout,
    length: expectSuccess(sampleCount(4_800)),
    storageKey: storageKeyOf(id, media),
  };
}

/** A plan to remove the records a project's recovery set aside, which it may have none of. */
function setAsideRecordsOf(project: ProjectId): CleanupPlan {
  return {
    steps: [
      { kind: 'set-aside-records', projects: [project], bytes: 0, loses: 'set-aside-changes' },
    ],
    confirmationBytes: 0,
  };
}

describe('the usage, asked of the storage worker', () => {
  it('measures the projects and the caches, one open in the worker taken as it is now', async () => {
    const storage = await used();
    const session = await opened(storage);
    const { contentId } = expectSuccess(await storage.another.store.put(generatedSource(3_000, 7)));
    storage.another.store.release(contentId);
    const media: ManagedMedia = {
      kind: 'managed',
      contentId,
      byteLength: 3_000,
      mediaType: 'audio/wav',
    };
    // A change kept in the journal alone, which no checkpoint holds yet.
    expectSuccess(await session.run(addAssetInvocation(assetOf(media), { media })));

    const usage = expectSuccess(await storage.client.usage.measure());

    expect(usage.sourceMedia).toBe(3_000);
    expect(usage.retainedDeletedMedia + usage.unreferencedMedia).toBe(0);
    expect(usage.caches.get(CacheCategory.Waveform)).toBeGreaterThanOrEqual(100);
    expect(usage.recoveryCheckpoints).toBeGreaterThan(0);
    expect(usage.unreadable).toEqual([]);
  });

  it('cleans a project the page holds through its session, whose lease is held', async () => {
    const storage = await used();
    const session = await opened(storage);
    const plan = setAsideRecordsOf(session.project);
    const confirmation = { bytes: 0 };

    const passedOver = expectSuccess(await storage.client.usage.runCleanup(plan, confirmation));
    const cleaned = expectSuccess(
      await storage.client.usage.runCleanup(plan, confirmation, { held: session }),
    );

    expect(passedOver).toEqual([{ step: 'set-aside-records', freed: 0, busy: [session.project] }]);
    expect(cleaned).toEqual([{ step: 'set-aside-records', freed: 0, busy: [] }]);
  });

  it('plans a cleanup removing nothing, and carries it out as planned', async () => {
    const { client } = await used();
    const cached = expectSuccess(await client.usage.measure()).caches.get(CacheCategory.Waveform);

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
