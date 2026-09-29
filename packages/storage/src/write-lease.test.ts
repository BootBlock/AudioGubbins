import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { changeNodeOf } from '@audiogubbins/history';
import type { AffectedEntities } from '@audiogubbins/project-format';
import { MemoryStorageTree, nodeDigest } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from './checked-records.js';
import { openProject, type OpenedProject } from './project-opening.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectSession } from './project-session.js';
import type { ReadOnlyProject } from './read-only-project.js';
import type { TransferRequest } from './write-lease.js';
import { FillableTree } from './testing/fillable-tree.js';
import { setName } from './testing/test-commands.js';
import {
  WINDOW_A,
  WINDOW_B,
  harness,
  madeProject,
  openToWrite,
  writable,
} from './testing/storage-harness.js';

/**
 * Two windows over one storage, sharing one coordinator as two tabs of one
 * browser profile share Web Locks (REQ-STOR-098): one writer at a time, the
 * other reading and seeing who writes; a transfer asked for and granted or
 * declined; a takeover after an explicit decision, fenced so the first window's
 * late write never counts; and no writer at all where the platform cannot
 * coordinate one.
 */

const PROJECT_AFFECTED: AffectedEntities = {
  assets: [],
  tracks: [],
  buses: [],
  clips: [],
  regions: [],
  markers: [],
  effectChains: [],
  project: true,
};

function requestsOf(session: ProjectSession): readonly TransferRequest[] {
  const { access } = session.getSnapshot();
  return access.kind === 'writable' ? access.transferRequests : [];
}

function readOnly(opened: OpenedProject): ReadOnlyProject {
  if (opened.kind !== 'read-only') throw new Error(`Expected read-only; it opened ${opened.kind}.`);
  return opened.view;
}

async function twoWindows() {
  const test = harness();
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const a = await openToWrite(test, tree, header.id, { owner: WINDOW_A });
  expectSuccess(await a.run(setName('Written by A')));
  const b = expectSuccess(
    await openProject(
      { project: header.id, access: 'write' },
      test.services(tree, { owner: WINDOW_B }),
    ),
  );
  return { test, tree, header, a, b };
}

describe('one writer per project (REQ-STOR-098)', () => {
  it('opens a second window read-only, showing who writes', async () => {
    const { b } = await twoWindows();
    const view = readOnly(b).getSnapshot();
    expect(view.access).toEqual({ kind: 'read-only', reason: { kind: 'busy', owner: WINDOW_A } });
    expect(view.model.state.project.displayName).toBe('Written by A');
  });

  it('hands the project over when the writer grants a request, and the asker then writes', async () => {
    const { test, tree, header, a, b } = await twoWindows();
    const asked = readOnly(b).requestTransfer();
    await Promise.resolve();
    const snapshot = a.getSnapshot();
    if (snapshot.access.kind !== 'writable') throw new Error('Expected A to write.');
    const [request] = snapshot.access.transferRequests;
    expect(request?.from).toEqual(WINDOW_B);
    if (request === undefined) throw new Error('No request reached A.');

    expectSuccess(await a.answerTransfer(request, 'granted'));
    expect(expectSuccess(await asked)).toBe('granted');
    expect(a.getSnapshot().access).toEqual({ kind: 'handed-over' });
    expect(expectFailureCode(await a.run(setName('Late')))).toBe('storage.not-writable');

    const taken = await openToWrite(test, tree, header.id, { owner: WINDOW_B });
    expect(taken.getSnapshot().model.state.project.displayName).toBe('Written by A');
    expectSuccess(await taken.run(setName('Written by B')));
  });

  it('refuses to hand over changes not yet saved, keeping the request until they are', async () => {
    const test = harness();
    const tree = new FillableTree(new MemoryStorageTree());
    const header = await madeProject(test, tree);
    const a = await openToWrite(test, tree, header.id, { owner: WINDOW_A });
    tree.full = true;
    expectSuccess(await a.run(setName('Not yet saved')));
    const b = expectSuccess(
      await openProject(
        { project: header.id, access: 'write' },
        test.services(tree, { owner: WINDOW_B }),
      ),
    );
    const asked = readOnly(b).requestTransfer();
    await Promise.resolve();
    const request = requestsOf(a)[0];
    if (request === undefined) throw new Error('No request reached A.');

    expect(expectFailureCode(await a.answerTransfer(request, 'granted'))).toBe(
      'storage.unsaved-changes',
    );
    expect(requestsOf(a)).toEqual([request]);
    tree.full = false;
    expectSuccess(await a.answerTransfer(request, 'granted'));
    expect(expectSuccess(await asked)).toBe('granted');
    const taken = await openToWrite(test, tree, header.id, { owner: WINDOW_B });
    expect(taken.getSnapshot().model.state.project.displayName).toBe('Not yet saved');
  });

  it('keeps writing when the writer declines a request', async () => {
    const { a, b } = await twoWindows();
    const asked = readOnly(b).requestTransfer();
    await Promise.resolve();
    const snapshot = a.getSnapshot();
    const request =
      snapshot.access.kind === 'writable' ? snapshot.access.transferRequests[0] : undefined;
    if (request === undefined) throw new Error('No request reached A.');
    expectSuccess(await a.answerTransfer(request, 'declined'));
    expect(expectSuccess(await asked)).toBe('declined');
    expect(a.getSnapshot().access).toEqual({ kind: 'writable', transferRequests: [] });
    expectSuccess(await a.run(setName('Still A')));
  });

  it('lets a window take the project after a decision, fencing the first window’s late write', async () => {
    const { test, tree, header, a } = await twoWindows();
    const before = a.getSnapshot().model;
    const b = writable(
      expectSuccess(
        await openProject(
          { project: header.id, access: 'write', steal: true },
          test.services(tree, { owner: WINDOW_B }),
        ),
      ),
    );

    // The first window hears it lost the project, and stops at once.
    await Promise.resolve();
    expect(a.getSnapshot().access).toMatchObject({
      kind: 'lost',
      loss: { kind: 'taken', by: WINDOW_B },
    });
    const pathsBefore = tree.paths();
    expect(expectFailureCode(await a.run(setName('Refused')))).toBe('storage.not-writable');
    expect(tree.paths()).toEqual(pathsBefore);

    // A write the first window had in flight lands after the takeover: its
    // epoch's record past the seal (A opened epoch 1 and wrote record 1).
    const late = changeNodeOf(before.history, {
      id: test.ids.next<'HistoryNodeId'>(),
      at: 1,
      entry: {
        description: 'Late',
        forward: [setName('Late')],
        inverse: [setName('Written by A')],
      },
      affects: PROJECT_AFFECTED,
    });
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
    await files.journal.append({ epoch: 1, sequence: 2 }, { kind: 'change', node: late });

    expectSuccess(await b.run(setName('Written by B')));
    const read = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(40).services(tree)),
    );
    expect(read.report.fenced).toEqual([{ epoch: 1, sequence: 2 }]);
    expect(readOnly(read).getSnapshot().model.state.project.displayName).toBe('Written by B');

    // Closing checkpoints, and the late record is set aside, never replayed.
    expectSuccess(await b.close());
    expect((await tree.list(files.paths.quarantine)).map((entry) => entry.name)).toEqual([
      'e000000000001-000000000002.json',
    ]);
    const again = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(41).services(tree)),
    );
    expect(again.report.fenced).toEqual([]);
    expect(readOnly(again).getSnapshot().model.state.project.displayName).toBe('Written by B');
  });

  it('opens read-only, saying why, where the platform cannot coordinate writers', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const opened = expectSuccess(
      await openProject(
        { project: header.id, access: 'write' },
        test.services(tree, { coordinator: 'none' }),
      ),
    );
    const view = readOnly(opened);
    expect(view.getSnapshot().access).toEqual({
      kind: 'read-only',
      reason: { kind: 'no-coordination' },
    });
    expect(expectFailureCode(await view.requestTransfer())).toBe('storage.no-coordination');
  });

  it('refuses to delete a project another window is writing', async () => {
    const { test, tree, header } = await twoWindows();
    expect(expectFailureCode(await test.repository(tree).softDelete(header.id))).toBe(
      'storage.project-busy',
    );
  });
});
