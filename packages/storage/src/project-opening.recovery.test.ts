import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { activeLine } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { openProject } from './project-opening.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { summaryOf } from './testing/model-summary.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite, writable } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * A crash at any moment of opening a project to write, which recovers it, takes
 * its lease and writes it again on closing, or of compacting its history
 * (REQ-STOR-101, REQ-STOR-055, REQ-EXEC-180): afterwards the project opens to
 * what it was before, or to what the operation made of it, never to anything
 * else and never short of a state it keeps, and it goes on working.
 */

/** The project as a window opening it to write finds it, closed again at once. */
async function reopened(tree: MemoryStorageTree, project: ProjectId, seed: number) {
  const session = writable(
    expectSuccess(await openProject({ project, access: 'write' }, harness(seed).services(tree))),
  );
  const summary = summaryOf(session.getSnapshot().model);
  expectSuccess(await session.close());
  return summary;
}

/** The project goes on working: a change made after the crash is kept. */
async function goesOn(tree: MemoryStorageTree, project: ProjectId, seed: number): Promise<void> {
  const session = await openToWrite(harness(seed), tree, project);
  expectSuccess(await session.run(setName('After the crash')));
  expectSuccess(await session.close());
  const opened = expectSuccess(
    await openProject({ project, access: 'read' }, harness(seed + 1).services(tree)),
  );
  if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
  expect(opened.view.getSnapshot().model.state.project.displayName).toBe('After the crash');
  expect(opened.report.journalBreak).toBeUndefined();
  expect(opened.report.missingStates).toEqual([]);
}

describe('a crash while a project is opened (REQ-STOR-101)', () => {
  it('opens, after every crash, to the project as its last window left it, and goes on', async () => {
    const test = harness(61);
    const left = new MemoryStorageTree();
    const header = await madeProject(test, left);
    const session = await openToWrite(test, left, header.id, {
      cadence: { checkpointAfter: 3, keepStateEvery: 2 },
    });
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      expectSuccess(await session.run(setName(name)));
    }
    expectSuccess(await session.undo());
    const summary = summaryOf(session.getSnapshot().model);

    // The window went without closing, so its newest changes are in the journal
    // alone, for the opening to replay and write again.
    const operations = await sweepCrashes({
      from: left.restarted(),
      tornWrites: ['short', 'full-length'],
      run: async (tree) => await reopened(tree, header.id, 62),
      check: async (found) => {
        expect(await reopened(found, header.id, 63)).toBe(summary);
        await goesOn(found, header.id, 64);
      },
    });
    expect(operations).toBeGreaterThan(10);
  }, 120_000);
});

describe('a crash while a history is compacted (REQ-STOR-055)', () => {
  it('opens, after every crash, to the history before or after it, and goes on', async () => {
    const test = harness(65);
    const from = new MemoryStorageTree();
    const header = await madeProject(test, from);
    const session = await openToWrite(test, from, header.id);
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      expectSuccess(await session.run(setName(name)));
    }
    const before = summaryOf(session.getSnapshot().model);
    expectSuccess(await session.close());

    let after: string | undefined;
    await sweepCrashes({
      from,
      run: async (tree) => {
        const compacting = await openToWrite(harness(66), tree, header.id);
        const newRoot = activeLine(compacting.getSnapshot().model.history)[2]?.id;
        if (newRoot === undefined) throw new Error('No third node.');
        const plan = expectSuccess(
          await compacting.planCompaction({ kind: 'before', node: newRoot }),
        );
        expect(expectSuccess(await compacting.compactHistory(plan, plan))).toEqual({
          kind: 'written',
        });
        const compacted = summaryOf(compacting.getSnapshot().model);
        expectSuccess(await compacting.close());
        return compacted;
      },
      check: async (found, { at, outcome }) => {
        if (at === undefined) after = outcome;
        expect([before, after]).toContain(await reopened(found, header.id, 67));
        await goesOn(found, header.id, 68);
      },
    });
    expect(after).toBeDefined();
  }, 120_000);
});
