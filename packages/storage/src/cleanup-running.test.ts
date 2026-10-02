import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { changeNodeOf } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { Turns } from '@audiogubbins/project-format';
import { immediateTurns } from '@audiogubbins/project-format/testing';

import { BackupGenerations } from './backup-generations.js';
import { BackupScheduler } from './backup-scheduler.js';
import { CheckedRecords } from './checked-records.js';
import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import { readProjectCopy } from './project-copy.js';
import { ProjectFiles } from './project-files.js';
import { openProject } from './project-opening.js';
import { PausingTree } from './testing/pausing-tree.js';
import { storageOf } from './testing/memory-ports.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite, writable, type Harness } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * A cleanup carried out against storage as it is by then, not as it was planned
 * (REQ-STOR-106, REQ-STOR-102): a project being made and a backup generation
 * being written look, until they are whole, like what a crash left, so cleanup
 * passes over them while they are written and says why; and only what the
 * person was shown is removed, under the policy the project holds when the
 * cleanup runs.
 */

/** A closed project, and the storage over its tree. */
async function closedProject(seed: number) {
  const test = harness(seed);
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  return { test, tree, project: header.id, storage: storageOf(test, tree) };
}

async function confirmedRun(
  plan: Parameters<typeof runCleanup>[0],
  test: Harness,
  tree: MemoryStorageTree,
) {
  return expectSuccess(
    await runCleanup(plan, { bytes: plan.confirmationBytes }, storageOf(test, tree).cleaning),
  );
}

describe('a cleanup run while storage is written', () => {
  it('passes over a project being made, which is whole once made', async () => {
    const { test, tree, storage } = await closedProject(121);
    const pausing = new PausingTree(tree);
    const pause = pausing.pauseAt('write', (path) => path.includes('/heads/'));
    const making = madeProject(test, pausing, 'Being made');
    await pause.reached;

    const plan = expectSuccess(
      await planCleanup([{ kind: 'unfinished-projects' }], storage.cleaning, 0),
    );
    expect(plan.steps).toMatchObject([{ kind: 'unfinished-projects' }]);
    expect(await confirmedRun(plan, test, tree)).toEqual([
      { step: 'unfinished-projects', freed: 0, busy: [], refused: { kind: 'storing' } },
    ]);

    pause.resume();
    const made = await making;
    const opened = expectSuccess(
      await openProject({ project: made.id, access: 'read' }, harness(122).services(tree)),
    );
    if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
    expect(opened.view.getSnapshot().model.state.project.displayName).toBe('Being made');
  });

  it('passes over a backup generation being written, which is whole once written', async () => {
    const { test, tree, project, storage } = await closedProject(123);
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), project);
    const copy = expectSuccess(await readProjectCopy(files, test.services(tree)));
    const pausing = new PausingTree(tree);
    const pause = pausing.pauseAt('write', (path) => path.endsWith('/checkpoint.json'));
    const writing = new BackupGenerations(pausing, nodeDigest, project).create(
      copy,
      { reason: 'time', at: test.clock.now(), protect: false },
      new Turns(immediateTurns),
      test.coordinator,
    );
    await pause.reached;

    const plan = expectSuccess(
      await planCleanup([{ kind: 'expired-backups' }], storage.cleaning, 0),
    );
    expect(plan.steps).toMatchObject([
      { kind: 'expired-backups', generations: new Map([[project, [1]]]) },
    ]);
    expect(await confirmedRun(plan, test, tree)).toEqual([
      { step: 'expired-backups', freed: 0, busy: [], refused: { kind: 'storing' } },
    ]);

    pause.resume();
    const made = expectSuccess(await writing);
    expectSuccess(await new BackupGenerations(tree, nodeDigest, project).copyOf(made.number));
  });

  it('leaves a generation being written to the scheduler’s pruning of incomplete ones', async () => {
    const { test, tree, project } = await closedProject(124);
    const session = await openToWrite(test, tree, project);
    expectSuccess(await session.run(setName('Changed')));
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), project);
    const copy = expectSuccess(await readProjectCopy(files, test.services(tree)));
    const pausing = new PausingTree(tree);
    const pause = pausing.pauseAt('write', (path) => path.endsWith('/checkpoint.json'));
    const writing = new BackupGenerations(pausing, nodeDigest, project).create(
      copy,
      { reason: 'manual', at: test.clock.now(), protect: true },
      new Turns(immediateTurns),
      test.coordinator,
    );
    await pause.reached;

    const scheduler = new BackupScheduler(project, storageOf(test, tree).exporting);
    expectSuccess(await scheduler.backUpNow(test.clock.now(), session.getSnapshot().model));
    pause.resume();
    const made = expectSuccess(await writing);
    expectSuccess(await new BackupGenerations(tree, nodeDigest, project).copyOf(made.number));
  });
});

/** Sets aside one more journal record of a project, as recovery does with one it refuses. */
async function setAsideOne(tree: MemoryStorageTree, project: ProjectId, seed: number) {
  const test = harness(seed);
  const session = await openToWrite(test, tree, project);
  expectSuccess(await session.run(setName(`Kept ${String(seed)}`)));
  const { model } = session.getSnapshot();
  const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), project);
  const node = changeNodeOf(model.history, {
    id: test.ids.next<'HistoryNodeId'>(),
    at: 1,
    entry: { description: 'Claimed', forward: [setName('Claimed')], inverse: [setName('Kept')] },
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
    expectSuccess(
      await openProject({ project, access: 'write' }, harness(seed + 1).services(tree)),
    ),
  );
  expectSuccess(await recovered.checkpoint());
  expectSuccess(await recovered.close());
  return files.paths.quarantine;
}

describe('a cleanup run on what it was shown', () => {
  it('removes the records set aside it planned, and keeps those set aside since', async () => {
    const { test, tree, project, storage } = await closedProject(125);
    const quarantine = await setAsideOne(tree, project, 126);
    const planned = (await tree.list(quarantine)).map(({ name }) => name);
    expect(planned).toHaveLength(1);
    const plan = expectSuccess(
      await planCleanup([{ kind: 'set-aside-records' }], storage.cleaning, 0),
    );

    await setAsideOne(tree, project, 128);
    const since = (await tree.list(quarantine))
      .map(({ name }) => name)
      .filter((name) => !planned.includes(name));
    expect(since).toHaveLength(1);
    await confirmedRun(plan, test, tree);
    expect((await tree.list(quarantine)).map(({ name }) => name)).toEqual(since);
  });

  it('keeps the generations a policy set since the plan keeps', async () => {
    const { test, tree, project, storage } = await closedProject(129);
    const session = await openToWrite(test, tree, project);
    const policy = (count: number) =>
      session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 },
        retention: { count },
      });
    expectSuccess(await policy(10));
    const scheduler = new BackupScheduler(project, storage.exporting);
    for (const name of ['One', 'Two', 'Three']) {
      expectSuccess(await session.run(setName(name)));
      expectSuccess(await scheduler.tick(test.clock.now(), session.getSnapshot().model));
    }
    expectSuccess(await policy(1));
    const plan = expectSuccess(
      await planCleanup([{ kind: 'expired-backups' }], storage.cleaning, 0),
    );
    expect(plan.steps).toMatchObject([{ generations: new Map([[project, [2, 1]]]) }]);

    expectSuccess(await policy(10));
    expectSuccess(await session.close());
    expect(await confirmedRun(plan, test, tree)).toEqual([
      { step: 'expired-backups', freed: 0, busy: [] },
    ]);
    const listing = expectSuccess(await new BackupGenerations(tree, nodeDigest, project).list());
    expect(listing.generations.map(({ number }) => number)).toEqual([3, 2, 1]);
  });
});
