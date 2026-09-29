/**
 * The scenarios of a window reading a project another writes: it loads the
 * latest state whenever the writer writes a checkpoint, lets the project go or
 * is replaced, and its reason follows the writer; and its request for the
 * project settles `unreachable` where the writer cannot be reached or never
 * answers, rather than waiting for ever (REQ-STOR-098).
 */

import { expect } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { openProject } from '../project-opening.js';
import type { ReadOnlyProject } from '../read-only-project.js';
import type { LeaseOwner } from '../write-lease.js';
import {
  madeProject,
  nameSeenBy,
  openToWrite,
  readOnly,
  sceneOf,
  twoWindows,
  until,
  type LeasePlatform,
} from './lease-scene.js';
import { WINDOW_A, WINDOW_B, writable } from './storage-harness.js';
import { setName } from './test-commands.js';

const WINDOW_C: LeaseOwner = { instance: 'window-c', label: 'Window C' };

/** The instance a reading window says writes the project, where it names one. */
function ownerNamedTo(view: ReadOnlyProject): string | undefined {
  const { access } = view.getSnapshot();
  return access.kind === 'read-only' && access.reason.kind === 'busy'
    ? access.reason.owner?.instance
    : undefined;
}

async function loadsEachCheckpoint(platform: LeasePlatform): Promise<void> {
  const { scene, a, b } = await twoWindows(platform);
  const view = readOnly(b);
  expectSuccess(await a.run(setName('Journalled only')));
  await until(scene, () => false);
  expect(nameSeenBy(view)).toBe('Written by A');

  expectSuccess(await a.checkpoint());
  await until(scene, () => nameSeenBy(view) === 'Journalled only');
  expect(nameSeenBy(view)).toBe('Journalled only');

  // Once closed, the view hears nothing more.
  view.close();
  expectSuccess(await a.run(setName('After the view closed')));
  expectSuccess(await a.checkpoint());
  await until(scene, () => false);
  expect(nameSeenBy(view)).toBe('Journalled only');
}

async function followsTheWriter(platform: LeasePlatform): Promise<void> {
  const { scene, tree, header, a, b } = await twoWindows(platform);
  const view = readOnly(b);

  // The writer closes: everything it held is written, and none writes now.
  expectSuccess(await a.run(setName('Closed by A')));
  expectSuccess(await a.close());
  await until(scene, () => nameSeenBy(view) === 'Closed by A');
  expect(view.getSnapshot().access).toEqual({ kind: 'read-only', reason: { kind: 'released' } });
  expect(nameSeenBy(view)).toBe('Closed by A');

  // Another window opens it to write, and then a third takes it over.
  const c = await openToWrite(scene, tree, header, WINDOW_C);
  await until(scene, () => ownerNamedTo(view) === WINDOW_C.instance);
  expect(view.getSnapshot().access).toEqual({
    kind: 'read-only',
    reason: { kind: 'busy', owner: WINDOW_C },
  });
  expectSuccess(await c.run(setName('Written by C')));
  const taken = writable(
    expectSuccess(
      await openProject(
        { project: header.id, access: 'write', steal: true },
        scene.services(tree, WINDOW_A),
      ),
    ),
  );
  await until(
    scene,
    () => nameSeenBy(view) === 'Written by C' && ownerNamedTo(view) === WINDOW_A.instance,
  );
  expect(view.getSnapshot().access).toEqual({
    kind: 'read-only',
    reason: { kind: 'busy', owner: WINDOW_A },
  });
  expect(nameSeenBy(view)).toBe(taken.getSnapshot().model.state.project.displayName);
}

async function unreachableWhenUnanswered(platform: LeasePlatform): Promise<void> {
  const scene = sceneOf(platform);
  const tree = new MemoryStorageTree();
  const header = await madeProject(scene, tree);

  // A writer that holds the project and hears requests but answers none, as a
  // frozen tab.
  const acquired = await scene.windows
    .coordinatorFor(WINDOW_A)
    .acquire(header.id, { steal: false, owner: WINDOW_A });
  if (acquired.kind !== 'held') throw new Error('Expected the lease to be held.');
  acquired.lease.onTransferRequest(() => undefined);
  const view = readOnly(
    expectSuccess(
      await openProject({ project: header.id, access: 'write' }, scene.services(tree, WINDOW_B)),
    ),
  );
  const patience = new AbortController();
  const asked = view.requestTransfer(patience.signal);
  await scene.windows.settle();
  patience.abort();
  expect(expectSuccess(await asked)).toBe('unreachable');
  expect(await scene.windows.coordinatorFor(WINDOW_B).ownerOf(header.id)).toEqual(WINDOW_A);
  await acquired.lease.release();
}

/** Each scenario of a reading window, by what it shows. */
export const READER_SCENARIOS: readonly (readonly [
  string,
  (platform: LeasePlatform) => Promise<void>,
])[] = [
  [
    'loads the latest state into a reading window each time the writer checkpoints',
    loadsEachCheckpoint,
  ],
  [
    'loads the latest state and names the writer as the project is let go, opened and taken over',
    followsTheWriter,
  ],
  [
    'settles a request unreachable once the asker stops waiting on a writer that never answers',
    unreachableWhenUnanswered,
  ],
];
