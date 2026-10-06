/**
 * The scenarios of the lock on the person's library of saved chains and
 * presets: one window holds it at a time, the next waits until it is let go,
 * a wait called off ends with the caller's reason and takes nothing, and a
 * platform that refuses locks refuses this one too (REQ-AUDIO-017).
 */

import { expect } from 'vitest';

import type { StorageLocking } from '../write-lease.js';
import type { LeasePlatform } from './lease-scene.js';
import { WINDOW_A, WINDOW_B } from './storage-harness.js';

function held(locking: StorageLocking): () => Promise<void> {
  if (locking.kind !== 'held')
    throw new Error(`Expected the lock to be held; it was ${locking.kind}.`);
  return locking.release;
}

async function oneWindowAtATime(platform: LeasePlatform): Promise<void> {
  const windows = platform.windows();
  const a = windows.coordinatorFor(WINDOW_A);
  const b = windows.coordinatorFor(WINDOW_B);
  const first = held(await a.lockLibrary({}));

  let granted = false;
  const waiting = b.lockLibrary({}).then((locking) => {
    granted = true;
    return locking;
  });
  await windows.settle();
  expect(granted).toBe(false);

  await first();
  await windows.settle();
  const second = held(await waiting);
  expect(granted).toBe(true);
  await second();
}

async function aWaitCalledOffTakesNothing(platform: LeasePlatform): Promise<void> {
  const windows = platform.windows();
  const a = windows.coordinatorFor(WINDOW_A);
  const b = windows.coordinatorFor(WINDOW_B);
  const first = held(await a.lockLibrary({}));
  const called = new AbortController();
  const calledOff = b.lockLibrary({ signal: called.signal });
  await windows.settle();

  called.abort(new Error('The save was cancelled.'));
  await expect(calledOff).rejects.toThrow('The save was cancelled.');

  await first();
  await windows.settle();
  // Nothing was left holding the lock for the wait that was called off.
  const again = held(await a.lockLibrary({}));
  await again();
}

async function refusedWhereLocksAre(platform: LeasePlatform): Promise<void> {
  expect(await platform.refusing().lockLibrary({})).toEqual({ kind: 'unavailable' });
}

/** Each scenario of the library's lock, by what it shows. */
export const LIBRARY_LOCK_SCENARIOS: readonly (readonly [
  string,
  (platform: LeasePlatform) => Promise<void>,
])[] = [
  ['lets one window change the library at a time, the next once it is let go', oneWindowAtATime],
  ['ends a wait for the library called off, holding nothing for it', aWaitCalledOffTakesNothing],
  ['refuses the library’s lock where the platform refuses locks', refusedWhereLocksAre],
];
