import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { withStateFingerprint } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from './checked-records.js';
import { writeCheckpointAndHead } from './checkpoint-writing.js';
import { readHeads, writeHead } from './project-heads.js';
import { openProject, type OpenedProject } from './project-opening.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectSession } from './project-session.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';
import { PausingTree } from './testing/pausing-tree.js';
import { WINDOW_B, madeProject, openToWrite, writable } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';
import { SegmentLedger } from './segment-ledger.js';

/**
 * A writer that lost the project without yet hearing of it changes nothing that
 * counts (REQ-STOR-098): its head is refused, or fenced by the seal of its
 * epoch, or ranks below the new writer's; and what it removes after its last
 * reading of the lease is never what the new writer reads or writes, however
 * the two interleave. A window opens a project to write under the epoch after
 * the one it claims, so the first writer writes under epoch 2.
 */

async function nextTurn(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function nameOf(opened: OpenedProject): string {
  const model = opened.kind === 'read-only' ? opened.view.getSnapshot().model : undefined;
  return model?.state.project.displayName ?? '';
}

/** A project window A writes through a tree the test can pause, with two records since its checkpoint. */
async function writtenByA() {
  const test = harness();
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const paused = new PausingTree(tree);
  const a = await openToWrite(test, paused, header.id);
  expectSuccess(await a.run(setName('One')));
  expectSuccess(await a.checkpoint());
  expectSuccess(await a.run(setName('Two')));
  const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
  return { test, tree, header, paused, a, files };
}

async function takenByB(
  test: ReturnType<typeof harness>,
  tree: MemoryStorageTree,
  project: ProjectId,
): Promise<ProjectSession> {
  return writable(
    expectSuccess(
      await openProject(
        { project, access: 'write', steal: true },
        test.services(tree, { owner: WINDOW_B }),
      ),
    ),
  );
}

describe('a late writer moves no head', () => {
  it('refuses to write a head under a lease it no longer holds', async () => {
    const { test, a, files } = await writtenByA();
    const heads = await readHeads(files.records, files.paths);

    const written = await writeCheckpointAndHead(files, {
      id: test.ids.next<'CheckpointId'>(),
      model: a.getSnapshot().model,
      position: { epoch: 2, sequence: 2 },
      lease: { epoch: 2, seals: [], holder: 'another-opening' },
      unwritten: new Map(),
      ledger: new SegmentLedger(),
      ids: test.ids,
    });
    expect(expectFailureCode(written)).toBe('storage.lease-superseded');
    expect(await readHeads(files.records, files.paths)).toEqual(heads);
  });

  it('passes over a head written past its epoch’s seal', async () => {
    const { test, tree, header, a, files } = await writtenByA();
    const late = a.getSnapshot().model;

    // B takes the project when A had written one record since its checkpoint;
    // A's second record and a head of it land after, as if late.
    await tree.remove(files.paths.record(2, 2));
    await takenByB(test, tree, header.id);
    const checkpoint = test.ids.next<'CheckpointId'>();
    const cursorState = expectSuccess(await files.states.put(late.state));
    const history = expectSuccess(
      withStateFingerprint(late.history, late.history.cursor, cursorState),
    );
    await files.writeCheckpoint(
      checkpoint,
      {
        history,
        cursorState,
        keptStates: new Set([cursorState]),
        exports: [],
        retention: late.retention,
        backup: late.backup,
        leaseEpoch: 2,
      },
      new SegmentLedger(),
      test.ids,
    );
    expectSuccess(
      await writeHead(files.records, files.paths, {
        epoch: 2,
        checkpoint,
        journal: { epoch: 2, sequence: 2 },
      }),
    );

    const read = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(50).services(tree)),
    );
    expect(read.report.fallbacks).toMatchObject([{ reason: { kind: 'head-fenced' } }]);
    expect(nameOf(read)).toBe('One');
  });
});

describe('a writer that lost the project in the middle of a checkpoint', () => {
  it('writes its head late, removes nothing, and the new writer’s work survives a crash', async () => {
    const { test, tree, header, paused, a } = await writtenByA();
    const pause = paused.pauseAt('write', (path) => path.includes('/heads/'));
    const checkpointing = a.checkpoint();
    await pause.reached;

    // B takes the project while A is frozen just before writing its head.
    const b = await takenByB(test, tree, header.id);
    expectSuccess(await b.run(setName('By B')));
    const beforeA = tree.paths().filter((path) => !path.includes('/heads/'));

    const headsBefore = tree.paths().filter((path) => path.includes('/heads/'));
    pause.resume();
    expect(expectSuccess(await checkpointing)).not.toEqual({ kind: 'written' });
    for (let turn = 0; turn < 20; turn += 1) await nextTurn();
    expect(a.getSnapshot().access.kind).toBe('lost');
    expect(tree.paths().filter((path) => path.includes('/heads/'))).not.toEqual(headsBefore);
    expect(tree.paths().filter((path) => !path.includes('/heads/'))).toEqual(beforeA);

    // B never checkpoints: its window is gone. Reopening finds its change.
    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(60).services(tree)),
    );
    expect(nameOf(reopened)).toBe('By B');
  });

  it('removes only what its own head replaced, never what the new writer wrote since', async () => {
    const { test, tree, header, paused, a } = await writtenByA();
    const pause = paused.pauseAt('remove', () => true);
    const checkpointing = a.checkpoint();
    await pause.reached;

    // A passed its last reading of the lease and is frozen before removing
    // anything. B takes the project, changes it, and keeps its state whole for
    // a snapshot, as a new file among A's states.
    const b = await takenByB(test, tree, header.id);
    expectSuccess(await b.run(setName('By B')));
    expectSuccess(await b.createSnapshot({ name: 'Kept by B' }));
    expectSuccess(await b.run(setName('By B again')));

    // A goes on with its removals, whatever its session now says of them, in
    // turns the test lets pass until they are done.
    const before = tree.paths();
    pause.resume();
    await checkpointing;
    for (let turn = 0; turn < 20; turn += 1) await nextTurn();
    expect(before.filter((path) => !tree.paths().includes(path))).not.toEqual([]);

    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(61).services(tree)),
    );
    expect(reopened.report.missingStates).toEqual([]);
    expect(nameOf(reopened)).toBe('By B again');
    expectSuccess(await b.checkpoint());
  });

  it('cannot remove what a new writer read, since the new writer claims the project first', async () => {
    const { test, tree, header, a } = await writtenByA();
    // B's coordination never reaches A, as when a steal is not yet heard of,
    // and B is frozen at its first write of the lease, mid-way through opening.
    const bTree = new PausingTree(tree);
    const pause = bTree.pauseAt('write', (path) => path.includes('/leases/'));
    const opening = openProject(
      { project: header.id, access: 'write' },
      test.services(bTree, { owner: WINDOW_B, coordinator: new MemoryLeaseCoordinator() }),
    );
    await pause.reached;

    // A writes on, checkpoints and removes what its new head replaced.
    expectSuccess(await a.run(setName('Three')));
    expect(expectSuccess(await a.checkpoint())).toEqual({ kind: 'written' });

    pause.resume();
    const b = writable(expectSuccess(await opening));
    expect(b.getSnapshot().model.state.project.displayName).toBe('Three');

    // B's window goes before it writes a checkpoint: the project still opens.
    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(62).services(tree)),
    );
    expect(nameOf(reopened)).toBe('Three');
  });
});
