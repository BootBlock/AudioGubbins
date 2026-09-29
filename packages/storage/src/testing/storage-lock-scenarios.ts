/**
 * The scenarios of the lock that spans the whole storage: any number of windows
 * share it while they store media not yet referred to, a purge holds it alone
 * and is refused at once while anyone shares it, a window that would share it
 * waits out a purge, and a platform that refuses locks refuses this one too
 * (REQ-STOR-102).
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

async function purgeWaitsForSharers(platform: LeasePlatform): Promise<void> {
  const windows = platform.windows();
  const a = windows.coordinatorFor(WINDOW_A);
  const b = windows.coordinatorFor(WINDOW_B);
  const first = held(await a.lockStorage('shared', { wait: true }));
  const second = held(await b.lockStorage('shared', { wait: true }));
  expect(await b.lockStorage('exclusive', { wait: false })).toEqual({ kind: 'busy' });
  await first();
  expect(await b.lockStorage('exclusive', { wait: false })).toEqual({ kind: 'busy' });
  await second();
  await windows.settle();
  const purge = held(await b.lockStorage('exclusive', { wait: false }));
  await purge();
}

async function sharersWaitOutAPurge(platform: LeasePlatform): Promise<void> {
  const windows = platform.windows();
  const a = windows.coordinatorFor(WINDOW_A);
  const b = windows.coordinatorFor(WINDOW_B);
  const purge = held(await a.lockStorage('exclusive', { wait: false }));
  expect(await b.lockStorage('shared', { wait: false })).toEqual({ kind: 'busy' });

  let granted = false;
  const waiting = b.lockStorage('shared', { wait: true }).then((locking) => {
    granted = true;
    return locking;
  });
  const called = new AbortController();
  const calledOff = b.lockStorage('shared', { wait: true, signal: called.signal });
  await windows.settle();
  expect(granted).toBe(false);
  called.abort(new Error('The import was cancelled.'));
  await expect(calledOff).rejects.toThrow('The import was cancelled.');

  await purge();
  await windows.settle();
  const share = held(await waiting);
  expect(await a.lockStorage('exclusive', { wait: false })).toEqual({ kind: 'busy' });
  await share();
}

async function refusedWhereLocksAre(platform: LeasePlatform): Promise<void> {
  const refusing = platform.refusing();
  expect(await refusing.lockStorage('exclusive', { wait: false })).toEqual({
    kind: 'unavailable',
  });
  expect(await refusing.lockStorage('shared', { wait: true })).toEqual({ kind: 'unavailable' });
}

/** Each scenario of the storage-wide lock, by what it shows. */
export const STORAGE_LOCK_SCENARIOS: readonly (readonly [
  string,
  (platform: LeasePlatform) => Promise<void>,
])[] = [
  ['refuses a purge the lock while any window stores media, however many', purgeWaitsForSharers],
  ['keeps a window from storing media while a purge runs, until it ends', sharersWaitOutAPurge],
  ['refuses the storage-wide lock where the platform refuses locks', refusedWhereLocksAre],
];
