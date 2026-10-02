import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { contentReferencedBy } from '@audiogubbins/media-store';
import { MemoryStorageTree, SimulatedCrash } from '@audiogubbins/media-store/testing';
import type { ContentId } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import { BackupScheduler } from './backup-scheduler.js';
import { CACHE_CLEANUP_ORDER, CacheCategory, type CacheKey } from './cache-store.js';
import { planCleanup } from './cleanup-planning.js';
import { runCleanup, type CleanupRunServices } from './cleanup-running.js';
import { relieveStoragePressure } from './storage-pressure.js';
import { retainedMedia } from './media-roots.js';
import { openProject } from './project-opening.js';
import { storageOf, storedMedia, type TestStorage } from './testing/memory-ports.js';
import { randomStep } from './testing/random-sessions.js';
import { seededRandom } from './testing/seeded-random.js';
import { madeProject, openToWrite, type Harness } from './testing/storage-harness.js';
import { addAsset } from './testing/test-commands.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * Cleanup under storage pressure (REQ-STOR-106, REQ-STOR-102, REQ-STOR-027):
 * the steps come in the safe order with what each frees and loses; nothing past
 * the caches is removed without the person's confirmation of what they were
 * shown; relieving pressure gives up caches alone; and no media anything can
 * still reach is ever removed.
 */

interface World {
  readonly test: Harness;
  readonly storage: TestStorage;
  readonly tree: MemoryStorageTree;
  readonly services: CleanupRunServices;
  readonly project: ProjectId;
  readonly current: ContentId;
  readonly undone: ContentId;
  readonly unreferenced: ContentId;
}

async function world(seed = 1): Promise<World> {
  const test = harness(seed);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const [current, undone, unreferenced] = [
    await storedMedia(storage.store, seed * 10 + 1),
    await storedMedia(storage.store, seed * 10 + 2),
    await storedMedia(storage.store, seed * 10 + 3, 5_000),
  ];
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), current)));
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), undone)));
  expectSuccess(await session.undo());
  expectSuccess(await session.close());
  for (const [index, category] of CACHE_CLEANUP_ORDER.entries()) {
    const key: CacheKey = { category, scope: { kind: 'media', content: current }, name: 'derived' };
    expectSuccess(await storage.caches.put(key, new Uint8Array(100 * (index + 1))));
  }
  return {
    test,
    storage,
    tree,
    services: storage.cleaning,
    project: header.id,
    current,
    undone,
    unreferenced,
  };
}

function itemOf<TItem>(items: readonly TItem[], index: number): TItem {
  const item = items[index];
  if (item === undefined) throw new Error(`No item ${String(index)}.`);
  return item;
}

async function held(storage: TestStorage): Promise<readonly ContentId[]> {
  const objects: ContentId[] = [];
  for await (const { contentId } of storage.store.list()) objects.push(contentId);
  return objects;
}

describe('cleanup (REQ-STOR-106, REQ-STOR-102)', () => {
  it('plans every step in the safe order, with what each frees and loses', async () => {
    const { services } = await world();
    const plan = expectSuccess(await planCleanup('everything', services, 0));
    expect(plan.steps.map((step) => (step.kind === 'cache' ? step.category : step.kind))).toEqual([
      ...CACHE_CLEANUP_ORDER,
      'unreferenced-media',
    ]);
    expect(plan.steps.map(({ loses }) => loses)).toEqual([
      ...CACHE_CLEANUP_ORDER.map(() => 'nothing'),
      'unreferenced-media',
    ]);
    expect(plan.confirmationBytes).toBe(5_000);
  });

  it('removes nothing past the caches, nor anything at all, without the confirmation shown', async () => {
    const { services, tree } = await world();
    const plan = expectSuccess(await planCleanup('everything', services, 0));
    const before = tree.snapshot();
    for (const confirmation of [undefined, { bytes: plan.confirmationBytes - 1 }]) {
      const run = await runCleanup(plan, confirmation, services);
      expect(run.ok).toBe(false);
      expect(tree.snapshot()).toEqual(before);
    }
  });

  it('carries a confirmed plan out and never removes media the project can reach', async () => {
    const { services, storage, project, test, current, undone, unreferenced } = await world();
    const plan = expectSuccess(await planCleanup('everything', services, 0));
    const outcomes = expectSuccess(
      await runCleanup(plan, { bytes: plan.confirmationBytes }, services),
    );
    expect(outcomes.at(-1)).toMatchObject({ step: 'unreferenced-media', freed: 5_000 });
    const objects = await held(storage);
    expect(objects).toContain(current);
    expect(objects).toContain(undone);
    expect(objects).not.toContain(unreferenced);
    for (const category of CACHE_CLEANUP_ORDER) {
      expect(expectSuccess(await storage.caches.usage()).get(category)).toBe(0);
    }

    // The change that added the undone media can still be redone, with its media.
    const session = await openToWrite(test, storage.tree, project);
    expectSuccess(await session.redo());
    const state = session.getSnapshot().model.state;
    expect([...contentReferencedBy(state)]).toContain(undone);
    expectSuccess(await storage.store.verify(undone));
  });

  it('runs a plan of caches alone without asking', async () => {
    const { services, storage } = await world();
    const plan = expectSuccess(
      await planCleanup([{ kind: 'cache', category: CacheCategory.Waveform }], services, 0),
    );
    expect(plan.confirmationBytes).toBe(0);
    expectSuccess(await runCleanup(plan, undefined, services));
    const usage = expectSuccess(await storage.caches.usage());
    expect(usage.get(CacheCategory.Waveform)).toBe(0);
    expect(usage.get(CacheCategory.Temporary)).toBeGreaterThan(0);
  });

  it('relieves pressure by giving up caches alone, in order, until enough is freed', async () => {
    const { storage, tree } = await world();
    const notCaches = () => [...tree.snapshot()].filter(([path]) => !path.startsWith('cache/'));
    const before = notCaches();
    const usage = expectSuccess(await storage.caches.usage());
    const temporary = usage.get(CacheCategory.Temporary) ?? 0;
    const relief = expectSuccess(await relieveStoragePressure(storage.caches, temporary + 1));
    expect([...relief.freed.keys()]).toEqual([CacheCategory.Temporary, CacheCategory.Render]);
    expect(notCaches()).toEqual(before);
    expectSuccess(await relieveStoragePressure(storage.caches));
    expect(notCaches()).toEqual(before);
    expect(tree.paths().filter((path) => path.startsWith('cache/'))).toEqual([]);
  });

  it('purges no media where something that could retain it cannot be read', async () => {
    const { services, tree, storage } = await world();
    const plan = expectSuccess(await planCleanup('everything', services, 0));
    const checkpoint = tree.paths().find((path) => path.includes('/checkpoints/'));
    if (checkpoint === undefined) throw new Error('No checkpoint.');
    await tree.writeFile(checkpoint, new Uint8Array([123]));

    const blocked = expectSuccess(await planCleanup('everything', services, 0));
    expect(blocked.steps.some((step) => step.kind === 'unreferenced-media')).toBe(false);
    expect(blocked.mediaRefused).toMatchObject({
      kind: 'unreadable',
      roots: [{ path: checkpoint }],
    });

    const before = await held(storage);
    const outcomes = expectSuccess(
      await runCleanup(plan, { bytes: plan.confirmationBytes }, services),
    );
    expect(outcomes.at(-1)).toMatchObject({ step: 'unreferenced-media', freed: 0 });
    expect(await held(storage)).toEqual(before);
  });

  it('removes a project whose making a crash cut short, and nothing else', async () => {
    const { services, tree, test } = await world();
    const crashed = tree.restarted({ crashAt: 4 });
    await expect(madeProject(test, crashed, 'Cut short')).rejects.toThrow(SimulatedCrash);
    const after = crashed.restarted();
    const afterServices = { ...services, ...storageOf(test, after).exporting, tree: after };
    const listed = [];
    for await (const entry of test.repository(after).list()) listed.push(entry);
    expect(listed).toHaveLength(1);

    const plan = expectSuccess(
      await planCleanup([{ kind: 'unfinished-projects' }], afterServices, 0),
    );
    expect(plan.steps).toHaveLength(1);
    const before = after.paths().length;
    expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, afterServices));
    expect(after.paths().length).toBeLessThan(before);
    const again = [];
    for await (const entry of test.repository(after).list()) again.push(entry);
    expect(again).toEqual(listed);
  });

  it('removes expired backup generations with confirmation, never protected ones', async () => {
    const { services, storage, test, project, current } = await world();
    const session = await openToWrite(test, storage.tree, project);
    expectSuccess(
      await session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 },
        retention: { count: 10 },
      }),
    );
    const scheduler = new BackupScheduler(project, storage.exporting);
    for (let round = 0; round < 3; round += 1) {
      expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), current)));
      expectSuccess(await scheduler.tick(test.clock.now(), session.getSnapshot().model));
    }
    const generations = new BackupGenerations(storage.tree, nodeDigest, project);
    expectSuccess(await generations.protect(1, true));
    expectSuccess(
      await session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 },
        retention: { count: 1 },
      }),
    );
    expectSuccess(await session.close());

    const plan = expectSuccess(await planCleanup([{ kind: 'expired-backups' }], services, 0));
    expect(plan.steps[0]).toMatchObject({ kind: 'expired-backups', loses: 'backup-generations' });
    expect(plan.steps[0]).toMatchObject({ generations: new Map([[project, [2]]]) });
    expect((await runCleanup(plan, undefined, services)).ok).toBe(false);

    // A generation protected after the plan was made is kept when it is carried out.
    expectSuccess(await generations.protect(2, true));
    expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, services));
    const numbers = async () =>
      expectSuccess(await generations.list()).generations.map(({ number }) => number);
    expect(await numbers()).toEqual([3, 2, 1]);

    expectSuccess(await generations.protect(2, false));
    const again = expectSuccess(await planCleanup([{ kind: 'expired-backups' }], services, 0));
    expectSuccess(await runCleanup(again, { bytes: again.confirmationBytes }, services));
    expect(await numbers()).toEqual([3, 1]);
  });

  it('plans expired backups under the policy the project holds now, its journal included', async () => {
    const { services, storage, test, project, current } = await world();
    const session = await openToWrite(test, storage.tree, project);
    const policy = (count: number) =>
      session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 },
        retention: { count },
      });
    expectSuccess(await policy(10));
    const scheduler = new BackupScheduler(project, storage.exporting);
    for (let round = 0; round < 3; round += 1) {
      expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), current)));
      expectSuccess(await scheduler.tick(test.clock.now(), session.getSnapshot().model));
    }
    expectSuccess(await policy(1));
    expectSuccess(await session.checkpoint());
    // The checkpoint keeps one generation; the window since keeps ten again,
    // which only its journal holds yet.
    expectSuccess(await policy(10));

    const plan = expectSuccess(await planCleanup([{ kind: 'expired-backups' }], services, 0));
    expect(plan.steps).toEqual([]);
  });

  it('removes the expired backups of the project this window writes, under its own lease', async () => {
    const { services, storage, test, project, current } = await world();
    const session = await openToWrite(test, storage.tree, project);
    const policy = (count: number) =>
      session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 },
        retention: { count },
      });
    expectSuccess(await policy(10));
    const scheduler = new BackupScheduler(project, storage.exporting);
    for (let round = 0; round < 3; round += 1) {
      expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), current)));
      expectSuccess(await scheduler.tick(test.clock.now(), session.getSnapshot().model));
    }
    expectSuccess(await policy(1));
    expectSuccess(await session.checkpoint());
    const generations = new BackupGenerations(storage.tree, nodeDigest, project);
    const numbers = async () =>
      expectSuccess(await generations.list()).generations.map(({ number }) => number);

    const plan = expectSuccess(await planCleanup([{ kind: 'expired-backups' }], services, 0));
    const confirmed = { bytes: plan.confirmationBytes };
    expect(expectSuccess(await runCleanup(plan, confirmed, services))).toMatchObject([
      { step: 'expired-backups', freed: 0, busy: [project] },
    ]);
    expect(await numbers()).toEqual([3, 2, 1]);

    const outcomes = expectSuccess(await runCleanup(plan, confirmed, services, { held: session }));
    expect(outcomes).toMatchObject([{ step: 'expired-backups', busy: [] }]);
    expect(await numbers()).toEqual([3]);
    expect(session.getSnapshot().access.kind).toBe('writable');
  });

  it.each([1, 2, 3, 4, 5, 6])(
    'never removes media anything retains, after random sessions: seed %i',
    async (seed) => {
      const test = harness(seed);
      const tree = new MemoryStorageTree();
      const storage = storageOf(test, tree);
      const media: ContentId[] = [];
      for (let index = 0; index < 8; index += 1) {
        media.push(await storedMedia(storage.store, seed * 100 + index));
      }
      const header = await madeProject(test, tree);
      const session = await openToWrite(test, tree, header.id, {
        cadence: { checkpointAfter: 4, keepStateEvery: 3 },
      });
      const run = {
        session,
        random: seededRandom(seed),
        test,
        media: (index: number) => itemOf(media, index % 6),
      };
      for (let step = 0; step < 40; step += 1) await randomStep(run, step);
      expectSuccess(await session.close());

      const services = storage.cleaning;
      const plan = expectSuccess(await planCleanup('everything', services, 0));
      expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, services));

      const objects = new Set(await held(storage));
      for await (const root of retainedMedia(tree, nodeDigest, () => undefined)) {
        if (media.includes(root)) expect(objects.has(root)).toBe(true);
      }
      expect(objects.has(itemOf(media, 6))).toBe(false);
      const opened = expectSuccess(
        await openProject({ project: header.id, access: 'read' }, test.services(tree)),
      );
      expect(opened.report.missingStates).toEqual([]);
      if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
      for (const content of contentReferencedBy(opened.view.getSnapshot().model.state)) {
        expect(objects.has(content)).toBe(true);
      }
    },
  );
});
