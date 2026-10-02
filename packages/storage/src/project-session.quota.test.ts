import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { ProjectId } from '@audiogubbins/domain';
import { TreeFailure, TreeFailureKind, type StorageTree } from '@audiogubbins/project-format';

import { openProject } from './project-opening.js';
import { isStorageFull, storageRefused } from './storage-failures.js';
import type { ProjectSession } from './project-session.js';
import type { WriteOutcome } from './write-queue.js';
import { FillableTree } from './testing/fillable-tree.js';
import { summaryOf } from './testing/model-summary.js';
import { addAsset, contentOf, setName } from './testing/test-commands.js';
import { harness } from './testing/node-services.js';
import { SETTINGS, madeProject, openToWrite, type Harness } from './testing/storage-harness.js';

/**
 * Storage pressure (REQ-STOR-106, REQ-EXEC-216, the packet's "Quota exhaustion
 * must never corrupt the last valid project state"): the storage fills at each
 * write of a scripted session in turn. The session keeps every change in memory
 * and says it is not saved and why; the project on disk stays the last one
 * fully written, and opens; once room returns, a retry writes everything
 * waiting, in order, and the project on disk is the one in memory.
 */

type Step = (session: ProjectSession) => Promise<WriteOutcome>;

function saved(result: Awaited<ReturnType<ProjectSession['run']>>): WriteOutcome {
  const outcome = expectSuccess(result);
  if (outcome.kind !== 'applied') throw new Error('Expected the change to apply.');
  return outcome.saved;
}

const SCRIPT: readonly Step[] = [
  async (session) => saved(await session.run(setName('One'))),
  async (session) =>
    saved(await session.run(addAsset('0000bbbb-0000-4000-8000-000000000001', contentOf(3)))),
  async (session) => expectSuccess(await session.createSnapshot({ name: 'Before two' })),
  async (session) => saved(await session.run(setName('Two'))),
  async (session) => expectSuccess(await session.checkpoint()),
  async (session) => expectSuccess(await session.undo()),
  async (session) => saved(await session.run(setName('Three'))),
  async (session) =>
    expectSuccess(
      await session.nameBranch(session.getSnapshot().model.history.cursor, 'Third way'),
    ),
  async (session) => saved(await session.run(setName('Four'))),
];

async function started(tree: StorageTree, test: Harness) {
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id, {
    cadence: { checkpointAfter: 3, keepStateEvery: 2 },
  });
  return { header, session };
}

/** The project a copy of the tree holds, opened to read. */
async function onDisk(inner: MemoryStorageTree, project: ProjectId): Promise<string> {
  const copy = inner.restarted();
  const opened = expectSuccess(
    await openProject({ project, access: 'read' }, harness(77).services(copy)),
  );
  if (opened.kind !== 'read-only') throw new Error('Expected a read-only project.');
  expect(opened.report.journalBreak).toBeUndefined();
  return summaryOf(opened.view.getSnapshot().model);
}

describe('storage filling up at every write', () => {
  it('keeps the last valid project on disk, says why nothing more is saved, and catches up in order', async () => {
    const counting = new FillableTree(new MemoryStorageTree());
    const counted = await started(counting, harness());
    const before = counting.writes;
    for (const step of SCRIPT) await step(counted.session);
    const writes = counting.writes - before;
    expect(writes).toBeGreaterThan(SCRIPT.length);

    for (let full = 1; full <= writes; full += 1) {
      const inner = new MemoryStorageTree();
      const tree = new FillableTree(inner);
      const { header, session } = await started(tree, harness());
      tree.fullAtWrite = tree.writes + full;

      const summaries = [summaryOf(session.getSnapshot().model)];
      let lastWritten = 0;
      for (const [index, step] of SCRIPT.entries()) {
        const outcome = await step(session);
        summaries.push(summaryOf(session.getSnapshot().model));
        if (outcome.kind === 'written') lastWritten = index + 1;
      }

      const status = session.getSnapshot().save;
      expect(status, `full at write ${String(full)}`).toMatchObject({
        kind: 'not-saved',
        cause: { code: 'storage.full' },
      });
      expect(await onDisk(inner, header.id), `full at write ${String(full)}`).toBe(
        summaries[lastWritten],
      );

      tree.full = false;
      expect(await session.retry()).toEqual({ kind: 'saved' });
      expect(await onDisk(inner, header.id)).toBe(summaryOf(session.getSnapshot().model));
    }
  });

  it('writes a change made while full once room returns, without a retry', async () => {
    const tree = new FillableTree(new MemoryStorageTree());
    const { header, session } = await started(tree, harness());
    tree.full = true;
    expect(saved(await session.run(setName('Held')))).toMatchObject({ kind: 'not-saved' });
    tree.full = false;
    expect(saved(await session.run(setName('Then')))).toEqual({ kind: 'written' });
    expect(session.getSnapshot().save).toEqual({ kind: 'saved' });
    const reader = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(9).services(tree)),
    );
    expect(reader.report.replayed).toBe(2);
  });

  it('says a save refused for want of room is full, and no other refusal', async () => {
    const tree = new FillableTree(new MemoryStorageTree());
    const { session } = await started(tree, harness());
    tree.full = true;
    const refused = saved(await session.run(setName('Held')));

    if (refused.kind !== 'not-saved') throw new Error('Expected the change to wait.');
    expect(isStorageFull(refused.cause)).toBe(true);
    for (const kind of [TreeFailureKind.Io, TreeFailureKind.Unavailable]) {
      expect(isStorageFull(storageRefused(new TreeFailure(kind, 'Refused.')))).toBe(false);
    }
  });

  it('refuses to make or open a project it cannot write, and lets the lease go', async () => {
    const tree = new FillableTree(new MemoryStorageTree());
    const test = harness();
    tree.full = true;
    const made = await test.repository(tree).create({ name: 'Full', settings: SETTINGS });
    expect(expectFailureCode(made)).toBe('storage.full');

    tree.full = false;
    const header = await madeProject(test, tree);
    tree.full = true;
    const refused = await openProject({ project: header.id, access: 'write' }, test.services(tree));
    expect(expectFailureCode(refused)).toBe('storage.full');
    tree.full = false;
    expect(
      expectSuccess(await openProject({ project: header.id, access: 'write' }, test.services(tree)))
        .kind,
    ).toBe('writable');
  });
});
