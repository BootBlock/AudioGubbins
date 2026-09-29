/**
 * What another package's tests may take from the storage's test support: the
 * single-writer scenarios every {@link LeaseCoordinator} must pass
 * (REQ-STOR-098, ADR-0020).
 *
 * The scenarios live here, not in one test, so the in-memory coordinator and
 * every platform's coordinator are held to the same behaviour rather than to
 * copies that drift apart. They drive whole sessions through
 * {@link openProject}, since what the requirement promises is what a window
 * sees: one writer at a time, the other reading and seeing who writes; a
 * transfer asked for and granted or declined; a takeover after an explicit
 * decision, fenced so the first window's late write never counts; and no writer
 * at all where the platform cannot coordinate one.
 *
 * Apart from the package's own entry point: an architecture rule refuses any
 * production module that reaches test support.
 */

import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { changeNodeOf } from '@audiogubbins/history';
import type { AffectedEntities, StorageTree } from '@audiogubbins/project-format';
import { MemoryStorageTree, nodeDigest } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from '../checked-records.js';
import { ProjectRepository } from '../project-catalogue.js';
import type { ProjectHeader } from '../project-header.js';
import { openProject, type OpenedProject, type OpeningServices } from '../project-opening.js';
import { ProjectFiles } from '../project-files.js';
import type { ProjectSession } from '../project-session.js';
import type { ReadOnlyProject } from '../read-only-project.js';
import type { LeaseCoordinator, LeaseOwner, TransferRequest } from '../write-lease.js';
import { FillableTree } from './fillable-tree.js';
import {
  SETTINGS,
  WINDOW_A,
  WINDOW_B,
  harness,
  writable,
  type Harness,
} from './storage-harness.js';
import { setName } from './test-commands.js';

/** The windows of one browser profile, made afresh for each scenario. */
export interface LeaseWindows {
  /** The coordinator a window opens projects with, the same one each time it is named. */
  coordinatorFor(owner: LeaseOwner): LeaseCoordinator;

  /** Waits until every message and lock change between the windows has arrived. */
  settle(): Promise<void>;
}

/** A platform's coordination, as the scenarios drive it. */
export interface LeasePlatform {
  readonly windows: () => LeaseWindows;

  /** What the platform gives where it cannot coordinate writers. */
  readonly uncoordinated: () => LeaseCoordinator | undefined;
}

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

/** One scenario's harness, storage and windows. */
interface Scene {
  readonly test: Harness;
  readonly windows: LeaseWindows;
  services(tree: StorageTree, owner: LeaseOwner): OpeningServices;
  repository(tree: StorageTree): ProjectRepository;
}

function sceneOf(platform: LeasePlatform, seed?: number): Scene {
  const test = harness(seed);
  const windows = platform.windows();
  return {
    test,
    windows,
    services: (tree, owner) =>
      test.services(tree, { owner, coordinator: windows.coordinatorFor(owner) }),
    repository: (tree) =>
      new ProjectRepository({
        tree,
        digest: nodeDigest,
        clock: test.clock,
        ids: test.ids,
        coordinator: windows.coordinatorFor(WINDOW_A),
        owner: WINDOW_A,
      }),
  };
}

async function madeProject(scene: Scene, tree: StorageTree): Promise<ProjectHeader> {
  return expectSuccess(
    await scene.repository(tree).create({ name: 'Forest walk', settings: SETTINGS }),
  );
}

async function openToWrite(
  scene: Scene,
  tree: StorageTree,
  header: ProjectHeader,
  owner: LeaseOwner,
): Promise<ProjectSession> {
  return writable(
    expectSuccess(
      await openProject({ project: header.id, access: 'write' }, scene.services(tree, owner)),
    ),
  );
}

function requestsOf(session: ProjectSession): readonly TransferRequest[] {
  const { access } = session.getSnapshot();
  return access.kind === 'writable' ? access.transferRequests : [];
}

function firstRequest(session: ProjectSession): TransferRequest {
  const request = requestsOf(session)[0];
  if (request === undefined) throw new Error('No request reached the writer.');
  return request;
}

function readOnly(opened: OpenedProject): ReadOnlyProject {
  if (opened.kind !== 'read-only') throw new Error(`Expected read-only; it opened ${opened.kind}.`);
  return opened.view;
}

async function twoWindows(platform: LeasePlatform) {
  const scene = sceneOf(platform);
  const tree = new MemoryStorageTree();
  const header = await madeProject(scene, tree);
  const a = await openToWrite(scene, tree, header, WINDOW_A);
  expectSuccess(await a.run(setName('Written by A')));
  const b = expectSuccess(
    await openProject({ project: header.id, access: 'write' }, scene.services(tree, WINDOW_B)),
  );
  return { scene, tree, header, a, b };
}

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
}

async function opensReadOnlyUncoordinated(platform: LeasePlatform): Promise<void> {
  const scene = sceneOf(platform);
  const tree = new MemoryStorageTree();
  const header = await madeProject(scene, tree);
  const opened = expectSuccess(
    await openProject(
      { project: header.id, access: 'write' },
      scene.test.services(tree, { coordinator: platform.uncoordinated() ?? 'none' }),
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

/** Each scenario, by what it shows. */
const SCENARIOS: readonly (readonly [string, (platform: LeasePlatform) => Promise<void>])[] = [
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
    opensReadOnlyUncoordinated,
  ],
  ['refuses to delete a project another window is writing', refusesToDeleteWhileWritten],
];

/** Runs the single-writer scenarios over a platform's coordination. */
export function describeWriteLeaseScenarios(name: string, platform: LeasePlatform): void {
  describe(`one writer per project over ${name} (REQ-STOR-098)`, () => {
    it.each(SCENARIOS)('%s', async (_title, scenario) => {
      await scenario(platform);
    });
  });
}
