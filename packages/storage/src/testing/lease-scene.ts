/**
 * What the single-writer scenarios share: the platform they are run over, the
 * storage and windows each scenario makes afresh, and the steps most of them
 * take (REQ-STOR-098).
 */

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { Digest, StorageTree } from '@audiogubbins/project-format';
import { immediateTurns } from '@audiogubbins/project-format/testing';

import { ProjectRepository } from '../project-catalogue.js';
import type { ProjectHeader } from '../project-header.js';
import { openProject, type OpenedProject, type OpeningServices } from '../project-opening.js';
import type { ProjectSession } from '../project-session.js';
import type { ReadOnlyProject } from '../read-only-project.js';
import type { LeaseCoordinator, LeaseOwner, TransferRequest } from '../write-lease.js';
import {
  SETTINGS,
  WINDOW_A,
  WINDOW_B,
  harnessOver,
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

  /** A coordinator of the platform whose every lock the platform refuses. */
  readonly refusing: () => LeaseCoordinator;

  /** The digest the windows' storage checks what it keeps with. */
  readonly digest: Digest;
}

/** One scenario's harness, storage and windows. */
export interface Scene {
  readonly test: Harness;
  readonly windows: LeaseWindows;
  services(tree: StorageTree, owner: LeaseOwner): OpeningServices;
  repository(tree: StorageTree): ProjectRepository;
}

export function sceneOf(platform: LeasePlatform, seed?: number): Scene {
  const test = harnessOver(platform.digest, seed);
  const windows = platform.windows();
  return {
    test,
    windows,
    services: (tree, owner) =>
      test.services(tree, { owner, coordinator: windows.coordinatorFor(owner) }),
    repository: (tree) =>
      new ProjectRepository({
        tree,
        digest: platform.digest,
        clock: test.clock,
        ids: test.ids,
        coordinator: windows.coordinatorFor(WINDOW_A),
        owner: WINDOW_A,
        yieldToHost: immediateTurns,
      }),
  };
}

export async function madeProject(scene: Scene, tree: StorageTree): Promise<ProjectHeader> {
  return expectSuccess(
    await scene.repository(tree).create({ name: 'Forest walk', settings: SETTINGS }),
  );
}

export async function openToWrite(
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

export function requestsOf(session: ProjectSession): readonly TransferRequest[] {
  const { access } = session.getSnapshot();
  return access.kind === 'writable' ? access.transferRequests : [];
}

export function firstRequest(session: ProjectSession): TransferRequest {
  const request = requestsOf(session)[0];
  if (request === undefined) throw new Error('No request reached the writer.');
  return request;
}

export function readOnly(opened: OpenedProject): ReadOnlyProject {
  if (opened.kind !== 'read-only') throw new Error(`Expected read-only; it opened ${opened.kind}.`);
  return opened.view;
}

/** A project written by window A and opened by window B, which reads it. */
export async function twoWindows(platform: LeasePlatform) {
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

/** The name the project has as a window reading it sees it. */
export function nameSeenBy(view: ReadOnlyProject): string {
  return view.getSnapshot().model.state.project.displayName;
}

/**
 * Lets the windows talk, and a reader load what it heard of, until `seen` holds
 * or a generous number of turns have passed.
 */
export async function until(scene: Scene, seen: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50 && !seen(); turn += 1) await scene.windows.settle();
}
