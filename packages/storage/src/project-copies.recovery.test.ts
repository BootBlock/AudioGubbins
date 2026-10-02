import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { deleteSnapshot } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { BackupGenerations } from './backup-generations.js';
import { BackupScheduler } from './backup-scheduler.js';
import { restoreBackup } from './backup-restoring.js';
import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import type { ProjectHeader } from './project-header.js';
import { forkProject } from './project-fork.js';
import { openProject } from './project-opening.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { storageOf } from './testing/memory-ports.js';
import { summaryOf } from './testing/model-summary.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * A crash at any moment of forking a project or of restoring one in place from
 * a backup (REQ-STOR-199, REQ-STOR-105, REQ-EXEC-180): the project copied from
 * is never changed, or is changed whole, with the generation that brings it
 * back kept; a fork is listed whole or not at all; and what a crash left is
 * found and removed by cleanup.
 */

async function listed(tree: MemoryStorageTree, seed: number): Promise<readonly ProjectHeader[]> {
  const headers: ProjectHeader[] = [];
  for await (const entry of harness(seed).repository(tree).list()) {
    if (entry.kind !== 'project') throw new Error(`${entry.name} cannot be read.`);
    headers.push(entry.header);
  }
  return headers;
}

async function summaryIn(tree: MemoryStorageTree, project: ProjectId, seed: number) {
  const opened = expectSuccess(
    await openProject({ project, access: 'read' }, harness(seed).services(tree)),
  );
  if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
  expect(opened.report.missingStates).toEqual([]);
  return summaryOf(opened.view.getSnapshot().model);
}

/**
 * The project's summary without the recovery snapshot restoring in place keeps
 * first, which must be at the point the project is at where it is there.
 */
async function unmarkedIn(tree: MemoryStorageTree, project: ProjectId, seed: number) {
  const opened = expectSuccess(
    await openProject({ project, access: 'read' }, harness(seed).services(tree)),
  );
  if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
  const { model } = opened.view.getSnapshot();
  const marks = [...model.history.snapshots.values()].filter(({ kind }) => kind === 'recovery');
  const [mark] = marks;
  if (mark === undefined) return summaryOf(model);
  expect(marks).toHaveLength(1);
  expect(mark.node).toBe(model.history.cursor);
  const history = expectSuccess(deleteSnapshot(model.history, mark.id));
  return summaryOf({ ...model, history });
}

/** Cleans up what a crash left, leaving only the projects listed. */
async function cleanedUp(tree: MemoryStorageTree, seed: number): Promise<void> {
  const services = storageOf(harness(seed), tree).cleaning;
  const plan = expectSuccess(await planCleanup([{ kind: 'unfinished-projects' }], services, 0));
  expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, services));
  const kept = new Set((await listed(tree, seed)).map(({ id }) => id));
  const directories = new Set(tree.paths().map((path) => path.split('/').slice(0, 2).join('/')));
  expect([...directories].filter((one) => one.startsWith('projects/'))).toEqual(
    [...kept].sort().map((id) => `projects/${id}`),
  );
}

describe('a crash while a project is forked (REQ-STOR-199)', () => {
  it('leaves the source as it was and the fork whole or not listed, at every operation', async () => {
    const test = harness(71);
    const from = new MemoryStorageTree();
    const header = await madeProject(test, from);
    const session = await openToWrite(test, from, header.id);
    expectSuccess(await session.run(setName('Source')));
    const snapshot = expectSuccess(await session.createSnapshot({ name: 'Kept' }));
    expect(snapshot).toEqual({ kind: 'written' });
    const [kept] = session.getSnapshot().model.history.snapshots.keys();
    if (kept === undefined) throw new Error('No snapshot.');
    expectSuccess(await session.close());
    const source = summaryOf(session.getSnapshot().model);

    await sweepCrashes({
      from,
      run: async (tree) =>
        await forkProject(
          { source: header.id, from: { kind: 'snapshot', snapshot: kept }, name: 'Fork' },
          harness(72).services(tree),
        ),
      check: async (found, { outcome }) => {
        if (outcome !== undefined) expectSuccess(outcome);
        expect(await summaryIn(found, header.id, 73)).toBe(source);
        const forks = (await listed(found, 74)).filter(({ id }) => id !== header.id);
        expect(forks.length).toBeLessThanOrEqual(1);
        for (const fork of forks) {
          const opened = expectSuccess(
            await openProject({ project: fork.id, access: 'read' }, harness(75).services(found)),
          );
          if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
          expect(opened.view.getSnapshot().model.state.project.displayName).toBe('Fork');
        }
        await cleanedUp(found, 76);
      },
    });
  }, 120_000);
});

describe('a crash while a project is restored in place from a backup (REQ-STOR-105)', () => {
  it('leaves the project as it was, or restored with the generation that brings it back', async () => {
    const test = harness(81);
    const from = new MemoryStorageTree();
    const header = await madeProject(test, from);
    const session = await openToWrite(test, from, header.id);
    expectSuccess(await session.run(setName('Backed up')));
    const scheduler = new BackupScheduler(header.id, storageOf(test, from).exporting);
    const made = expectSuccess(
      await scheduler.backUpNow(test.clock.now(), session.getSnapshot().model),
    );
    if (made.kind !== 'made') throw new Error('No generation was made.');
    const backedUp = summaryOf(session.getSnapshot().model);
    expectSuccess(await session.run(setName('After the backup')));
    expectSuccess(await session.close());
    const current = summaryOf(session.getSnapshot().model);

    let replaced = 0;
    await sweepCrashes({
      from,
      run: async (tree) => {
        const restored = expectSuccess(
          await restoreBackup(
            header.id,
            made.generation.number,
            { as: 'replace-current' },
            harness(82).services(tree),
          ),
        );
        if (restored.kind !== 'replaced') throw new Error('Expected the project replaced.');
        expectSuccess(await restored.session.close());
        return restored;
      },
      check: async (found) => {
        const summary = await unmarkedIn(found, header.id, 83);
        expect([current, backedUp]).toContain(summary);
        const generations = new BackupGenerations(found, nodeDigest, header.id);
        const listing = expectSuccess(await generations.list());
        // Every generation listed is whole; the protected ones are named.
        const kept: string[] = [];
        for (const generation of listing.generations) {
          const copy = expectSuccess(await generations.copyOf(generation.number));
          if (generation.protected) kept.push(copy.model.state.project.displayName);
        }
        if (summary === backedUp) {
          replaced += 1;
          // What the restoring replaced is kept, protected, to bring it back.
          expect(kept).toContain('After the backup');
        }
        const going = await openToWrite(harness(84), found, header.id);
        expectSuccess(await going.run(setName('After the crash')));
        expectSuccess(await going.close());
      },
    });
    expect(replaced).toBeGreaterThan(0);
  }, 120_000);
});
