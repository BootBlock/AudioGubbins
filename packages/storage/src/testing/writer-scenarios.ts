/**
 * The scenarios of who writes a project: one writer at a time, the other
 * reading and seeing who writes; a transfer asked for and granted or declined;
 * a takeover after an explicit decision, fenced so the first window's late
 * write never counts; and no writer at all where the platform cannot coordinate
 * one or refuses its lock (REQ-STOR-098).
 */

import { expect } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { changeNodeOf } from '@audiogubbins/history';
import type { AffectedEntities } from '@audiogubbins/project-format';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from '../checked-records.js';
import { openProject } from '../project-opening.js';
import { ProjectFiles } from '../project-files.js';
import type { LeaseCoordinator } from '../write-lease.js';
import { FillableTree } from './fillable-tree.js';
import {
  firstRequest,
  madeProject,
  openToWrite,
  readOnly,
  requestsOf,
  sceneOf,
  twoWindows,
  type LeasePlatform,
} from './lease-scene.js';
import { WINDOW_A, WINDOW_B, harnessOver, writable } from './storage-harness.js';
import { setName } from './test-commands.js';

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

async function showsTheWriter(platform: LeasePlatform): Promise<void> {
  const { b } = await twoWindows(platform);
  const view = readOnly(b).getSnapshot();
  expect(view.access).toEqual({
    kind: 'read-only',
    reason: { kind: 'busy', owner: WINDOW_A },
  });
  expect(view.model.state.project.displayName).toBe('Written by A');
}

async function handsOverOnGrant(platform: LeasePlatform): Promise<void> {
  const { scene, tree, header, a, b } = await twoWindows(platform);
  const asked = readOnly(b).requestTransfer();
  await scene.windows.settle();
  const request = firstRequest(a);
  expect(request.from).toEqual(WINDOW_B);

  expectSuccess(await a.answerTransfer(request, 'granted'));
  expect(expectSuccess(await asked)).toBe('granted');
  expect(a.getSnapshot().access).toEqual({ kind: 'handed-over' });
  expect(expectFailureCode(await a.run(setName('Late')))).toBe('storage.not-writable');

  const taken = await openToWrite(scene, tree, header, WINDOW_B);
  expect(taken.getSnapshot().model.state.project.displayName).toBe('Written by A');
  expectSuccess(await taken.run(setName('Written by B')));
}

async function handsOverOnlyWhenSaved(platform: LeasePlatform): Promise<void> {
  const scene = sceneOf(platform);
  const tree = new FillableTree(new MemoryStorageTree());
  const header = await madeProject(scene, tree);
  const a = await openToWrite(scene, tree, header, WINDOW_A);
  tree.full = true;
  expectSuccess(await a.run(setName('Not yet saved')));
  const b = expectSuccess(
    await openProject({ project: header.id, access: 'write' }, scene.services(tree, WINDOW_B)),
  );
  const asked = readOnly(b).requestTransfer();
  await scene.windows.settle();
  const request = firstRequest(a);

  expect(expectFailureCode(await a.answerTransfer(request, 'granted'))).toBe(
    'storage.unsaved-changes',
  );
  expect(requestsOf(a)).toEqual([request]);
  tree.full = false;
  expectSuccess(await a.answerTransfer(request, 'granted'));
  expect(expectSuccess(await asked)).toBe('granted');
  const taken = await openToWrite(scene, tree, header, WINDOW_B);
  expect(taken.getSnapshot().model.state.project.displayName).toBe('Not yet saved');
}

async function keepsWritingOnDecline(platform: LeasePlatform): Promise<void> {
  const { scene, a, b } = await twoWindows(platform);
  const asked = readOnly(b).requestTransfer();
  await scene.windows.settle();
  expectSuccess(await a.answerTransfer(firstRequest(a), 'declined'));
  expect(expectSuccess(await asked)).toBe('declined');
  expect(a.getSnapshot().access).toEqual({ kind: 'writable', transferRequests: [] });
  expectSuccess(await a.run(setName('Still A')));
}

async function takesOverFencingLateWrites(platform: LeasePlatform): Promise<void> {
  const { scene, tree, header, a } = await twoWindows(platform);
  const { test } = scene;
  const before = a.getSnapshot().model;
  const b = writable(
    expectSuccess(
      await openProject(
        { project: header.id, access: 'write', steal: true },
        scene.services(tree, WINDOW_B),
      ),
    ),
  );

  // The first window hears it lost the project, and stops at once.
  await scene.windows.settle();
  expect(a.getSnapshot().access).toMatchObject({
    kind: 'lost',
    loss: { kind: 'taken', by: WINDOW_B },
  });
  const pathsBefore = tree.paths();
  expect(expectFailureCode(await a.run(setName('Refused')))).toBe('storage.not-writable');
  expect(tree.paths()).toEqual(pathsBefore);

  // A write the first window had in flight lands after the takeover: its
  // epoch's record past the seal (A claimed epoch 1, opened under epoch 2 and
  // wrote record 1).
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
  const files = new ProjectFiles(new CheckedRecords(tree, platform.digest), header.id);
  await files.journal.append({ epoch: 2, sequence: 2 }, { kind: 'change', node: late });

  expectSuccess(await b.run(setName('Written by B')));
  const read = expectSuccess(
    await openProject(
      { project: header.id, access: 'read' },
      harnessOver(platform.digest, 40).services(tree),
    ),
  );
  expect(read.report.fenced).toEqual([{ epoch: 2, sequence: 2 }]);
  expect(readOnly(read).getSnapshot().model.state.project.displayName).toBe('Written by B');

  // Closing checkpoints, and the late record is set aside, never replayed.
  expectSuccess(await b.close());
  expect((await tree.list(files.paths.quarantine)).map((entry) => entry.name)).toEqual([
    'e000000000002-000000000002.json',
  ]);
  const again = expectSuccess(
    await openProject(
      { project: header.id, access: 'read' },
      harnessOver(platform.digest, 41).services(tree),
    ),
  );
  expect(again.report.fenced).toEqual([]);
  expect(readOnly(again).getSnapshot().model.state.project.displayName).toBe('Written by B');
}

async function opensReadOnlyWithout(
  platform: LeasePlatform,
  coordinator: LeaseCoordinator | undefined,
): Promise<void> {
  const scene = sceneOf(platform);
  const tree = new MemoryStorageTree();
  const header = await madeProject(scene, tree);
  const opened = expectSuccess(
    await openProject(
      { project: header.id, access: 'write' },
      scene.test.services(tree, { coordinator: coordinator ?? 'none' }),
    ),
  );
  const view = readOnly(opened);
  expect(view.getSnapshot().access).toEqual({
    kind: 'read-only',
    reason: { kind: 'no-coordination' },
  });
  expect(expectFailureCode(await view.requestTransfer())).toBe('storage.no-coordination');
}

async function refusesToDeleteWhileWritten(platform: LeasePlatform): Promise<void> {
  const { scene, tree, header } = await twoWindows(platform);
  expect(expectFailureCode(await scene.repository(tree).softDelete(header.id))).toBe(
    'storage.project-busy',
  );
}

/** Each scenario of who writes, by what it shows. */
export const WRITER_SCENARIOS: readonly (readonly [
  string,
  (platform: LeasePlatform) => Promise<void>,
])[] = [
  ['opens a second window read-only, showing who writes', showsTheWriter],
  [
    'hands the project over when the writer grants a request, and the asker then writes',
    handsOverOnGrant,
  ],
  [
    'refuses to hand over changes not yet saved, keeping the request until they are',
    handsOverOnlyWhenSaved,
  ],
  ['keeps writing when the writer declines a request', keepsWritingOnDecline],
  [
    'lets a window take the project after a decision, fencing the first window’s late write',
    takesOverFencingLateWrites,
  ],
  [
    'opens read-only, saying why, where the platform cannot coordinate writers',
    async (platform) => {
      await opensReadOnlyWithout(platform, platform.uncoordinated());
    },
  ],
  [
    'opens read-only, saying writers cannot be coordinated, where the platform refuses the lock',
    async (platform) => {
      await opensReadOnlyWithout(platform, platform.refusing());
    },
  ],
  ['refuses to delete a project another window is writing', refusesToDeleteWhileWritten],
];
