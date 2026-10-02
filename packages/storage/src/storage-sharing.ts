/**
 * The storage-wide lock, as the storage's writers and its cleaners take it
 * over the lease coordinator (REQ-STOR-102, REQ-STOR-106, ADR-0020).
 *
 * Some of what a window writes looks, until it is whole, like what a crash
 * left: media stored and not yet referred to, a project being made
 * (`project-creation.ts`) and a backup generation being written
 * (`backup-generations.ts`). So each writer of these shares the lock from
 * before it writes a byte until what it wrote is whole, waiting out any window
 * that holds it alone. Whatever removes such left-overs (a purge of media,
 * cleanup's steps for unfinished projects and incomplete generations, and a
 * scheduler pruning incomplete generations) takes the lock alone, never waiting
 * for it, since a window that waited for it while sharing it would wait for
 * ever, and checks again under it what it is about to remove: anything it finds
 * unfinished then was left by a crash, since no window is writing it.
 *
 * Where the platform has no coordinator, or refuses the lock, a writer shares
 * nothing and goes ahead, and nothing left over is removed, since nothing could
 * tell it from what another window is writing.
 */

import type { MediaSharing } from '@audiogubbins/media-store';

import type { LeaseCoordinator } from './write-lease.js';

/** What running work with the storage-wide lock held alone came to. */
export type Alone<TValue> =
  | { readonly kind: 'done'; readonly value: TValue }
  /** A window shares the lock, or holds it alone: something is being written. */
  | { readonly kind: 'busy' }
  /** The platform has no coordinator, or refused the lock. */
  | { readonly kind: 'unavailable' };

/**
 * Waits until no window holds the lock alone, then shares it until the
 * returned function is called. Shares nothing where it cannot be had.
 */
async function shared(
  coordinator: LeaseCoordinator | undefined,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  if (coordinator === undefined) return () => Promise.resolve();
  const locking = await coordinator.lockStorage('shared', {
    wait: true,
    ...(signal === undefined ? {} : { signal }),
  });
  return locking.kind === 'held' ? locking.release : () => Promise.resolve();
}

/** The sharing a window's media store is made with, over its coordinator. */
export function mediaSharingOf(coordinator: LeaseCoordinator | undefined): MediaSharing {
  return {
    share: async (signal) => {
      const release = await shared(coordinator, signal);
      return () => {
        void release();
      };
    },
  };
}

/** Runs `work`, which writes what is not whole until it ends, sharing the lock. */
export async function whileWriting<TValue>(
  coordinator: LeaseCoordinator | undefined,
  work: () => Promise<TValue>,
  signal?: AbortSignal,
): Promise<TValue> {
  const release = await shared(coordinator, signal);
  try {
    return await work();
  } finally {
    await release();
  }
}

/**
 * Runs `work`, which removes what may be left over, with the lock held alone,
 * or says why it could not be had now.
 */
export async function whileAlone<TValue>(
  coordinator: LeaseCoordinator | undefined,
  work: () => Promise<TValue>,
  signal?: AbortSignal,
): Promise<Alone<TValue>> {
  if (coordinator === undefined) return { kind: 'unavailable' };
  const locking = await coordinator.lockStorage('exclusive', {
    wait: false,
    ...(signal === undefined ? {} : { signal }),
  });
  if (locking.kind !== 'held') return locking;
  try {
    return { kind: 'done', value: await work() };
  } finally {
    await locking.release();
  }
}
