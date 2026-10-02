import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { changeNodeOf } from '@audiogubbins/history';
import { MemoryStorageTree, SimulatedCrash } from '@audiogubbins/media-store/testing';
import type { ContentId } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import { BackupScheduler } from './backup-scheduler.js';
import { CACHE_CLEANUP_ORDER } from './cache-store.js';
import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import { CheckedRecords } from './checked-records.js';
import { retainedMedia } from './media-roots.js';
import { ProjectFiles } from './project-files.js';
import { openProject } from './project-opening.js';
import { CACHE_DIRECTORY, PROJECTS_DIRECTORY, ProjectPaths } from './storage-layout.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { storageOf, storedMedia } from './testing/memory-ports.js';
import { summaryOf } from './testing/model-summary.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite, writable } from './testing/storage-harness.js';
import { addAsset, setName } from './testing/test-commands.js';

/**
 * A crash at any moment of carrying a confirmed cleanup out (REQ-STOR-106,
 * REQ-STOR-102, REQ-EXEC-180), over a storage with something for every step:
 * caches, a project whose making was cut short, expired backups, history the
 * retention lets go, records set aside and media nothing refers to.
 * Afterwards the project opens as it was or as its compaction left it, every
 * piece of media anything retains is whole, and the cleanup planned and run
 * again leaves the storage as the cleanup run whole did.
 */

/** A storage with something for every step of a cleanup to remove. */
async function untidy() {
  const test = harness(101);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const current = await storedMedia(storage.store, 1);
  await storedMedia(storage.store, 2, 5_000);
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  // Set while there is nothing to let go, so the history it lets go later is
  // left for cleanup.
  expectSuccess(
    await session.setRetentionPolicy({
      kind: 'rules',
      rules: [{ kind: 'recent-changes', count: 1 }],
    }),
  );
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), current)));
  expectSuccess(
    await session.setBackupPolicy({
      kind: 'automatic',
      trigger: { everyChanges: 1 },
      retention: { count: 10 },
    }),
  );
  const scheduler = new BackupScheduler(header.id, storage.exporting);
  for (const name of ['One', 'Two', 'Three']) {
    expectSuccess(await session.run(setName(name)));
    expectSuccess(await scheduler.tick(test.clock.now(), session.getSnapshot().model));
  }
  expectSuccess(
    await session.setBackupPolicy({
      kind: 'automatic',
      trigger: { everyChanges: 1 },
      retention: { count: 1 },
    }),
  );
  expectSuccess(await session.checkpoint());
  for (const name of ['Four', 'Five']) expectSuccess(await session.run(setName(name)));
  expectSuccess(await session.close());
  await setAside(tree, header.id);
  for (const category of CACHE_CLEANUP_ORDER) {
    const key = { category, scope: { kind: 'media', content: current }, name: 'derived' } as const;
    expectSuccess(await storage.caches.put(key, new Uint8Array(100)));
  }
  // A project whose making a crash cut short.
  const crashing = tree.restarted({ crashAt: 4 });
  await expect(madeProject(test, crashing, 'Cut short')).rejects.toThrow(SimulatedCrash);
  return { test, tree: crashing.restarted(), project: header.id };
}

/**
 * Writes a journal record whose change does not give the state it claims, so
 * recovery refuses it and the next checkpoint sets it aside.
 */
async function setAside(tree: MemoryStorageTree, project: ProjectId): Promise<void> {
  const test = harness(102);
  const session = await openToWrite(test, tree, project);
  expectSuccess(await session.run(setName('Six')));
  const { model } = session.getSnapshot();
  const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), project);
  const node = changeNodeOf(model.history, {
    id: test.ids.next<'HistoryNodeId'>(),
    at: 1,
    entry: { description: 'Claimed', forward: [setName('Claimed')], inverse: [setName('Six')] },
    affects: {
      assets: [],
      tracks: [],
      buses: [],
      clips: [],
      regions: [],
      markers: [],
      effectChains: [],
      project: true,
    },
    stateFingerprint: await files.states.fingerprint(model.state),
  });
  const epochs = (await tree.list(files.paths.journal)).filter(({ name }) => name.startsWith('e'));
  const epoch = Number(epochs.at(-1)?.name.slice(1));
  await files.journal.append({ epoch, sequence: 2 }, { kind: 'change', node });
  const recovered = writable(
    expectSuccess(await openProject({ project, access: 'write' }, harness(103).services(tree))),
  );
  expect(recovered.getSnapshot().model.state.project.displayName).toBe('Six');
  // Closing checkpoints, which sets the record aside; a checkpoint of its own
  // would let the retention policy compact the history left for cleanup.
  expectSuccess(await recovered.close());
  expect(await tree.list(files.paths.quarantine)).toHaveLength(1);
}

/** The project's summary, and that every piece of media anything retains is whole. */
async function settled(tree: MemoryStorageTree, project: ProjectId, seed: number) {
  const storage = storageOf(harness(seed), tree);
  expectSuccess(await storage.store.recoverIncomplete());
  const roots: ContentId[] = [];
  for await (const root of retainedMedia(tree, nodeDigest, () => undefined)) roots.push(root);
  for (const root of roots) expectSuccess(await storage.store.verify(root));
  const opened = expectSuccess(
    await openProject({ project, access: 'read' }, harness(seed + 1).services(tree)),
  );
  if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
  expect(opened.report.missingStates).toEqual([]);
  return summaryOf(opened.view.getSnapshot().model);
}

/**
 * What a cleanup leaves, apart from the names a writer gives the files it
 * writes: the media held, the backup generations, and the projects' places.
 */
async function leftBy(tree: MemoryStorageTree, project: ProjectId, seed: number) {
  const storage = storageOf(harness(seed), tree);
  const media: ContentId[] = [];
  for await (const { contentId } of storage.store.list()) media.push(contentId);
  const generations = expectSuccess(await new BackupGenerations(tree, nodeDigest, project).list());
  return {
    media,
    generations: generations.generations.map(({ number }) => number),
    incomplete: generations.incomplete,
    projects: (await tree.list(PROJECTS_DIRECTORY)).map(({ name }) => name),
    setAside: await tree.list(new ProjectPaths(project).quarantine),
    caches: await tree.list(CACHE_DIRECTORY),
  };
}

/**
 * The project written again, as using it writes it: a crash while a checkpoint
 * removed what it replaced leaves files that only the next checkpoint removes,
 * and until then they may be torn, so a purge of media must not count on them.
 */
async function writtenAgain(tree: MemoryStorageTree, project: ProjectId, seed: number) {
  const session = await openToWrite(harness(seed), tree, project);
  expectSuccess(await session.checkpoint());
  expectSuccess(await session.close());
}

/** Plans everything and carries it out. */
async function cleaned(tree: MemoryStorageTree, seed: number) {
  const services = storageOf(harness(seed), tree).cleaning;
  const plan = expectSuccess(await planCleanup('everything', services, 0));
  return expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, services));
}

describe('a crash while a cleanup is carried out (REQ-STOR-106)', () => {
  it('loses nothing kept, and the cleanup run again finishes it, at every operation', async () => {
    const { tree: from, project } = await untidy();
    const services = storageOf(harness(104), from).cleaning;
    const plan = expectSuccess(await planCleanup('everything', services, 0));
    expect(plan.steps.map(({ kind }) => kind)).toEqual([
      ...CACHE_CLEANUP_ORDER.map(() => 'cache'),
      'unfinished-projects',
      'expired-backups',
      'expired-history',
      'set-aside-records',
      'unreferenced-media',
    ]);
    const before = await settled(from.restarted(), project, 105);

    let whole: { readonly summary: string; readonly left: unknown } | undefined;
    const operations = await sweepCrashes({
      from,
      run: async (tree) => {
        const run = storageOf(harness(106), tree).cleaning;
        return await runCleanup(plan, { bytes: plan.confirmationBytes }, run);
      },
      check: async (found, { at, outcome }) => {
        if (outcome !== undefined) expectSuccess(outcome);
        const summary = await settled(found, project, 107);
        await writtenAgain(found, project, 108);
        if (at === undefined) {
          await cleaned(found, 109);
          whole = {
            summary: await settled(found, project, 110),
            left: await leftBy(found, project, 111),
          };
          return;
        }
        if (whole === undefined) throw new Error('The cleanup was not run whole first.');
        expect([before, whole.summary]).toContain(summary);
        await cleaned(found, 109);
        expect(await settled(found, project, 110)).toBe(whole.summary);
        expect(await leftBy(found, project, 111)).toEqual(whole.left);
      },
    });
    expect(operations).toBeGreaterThan(20);
  }, 120_000);
});
