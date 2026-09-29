/**
 * The media store's sharing of the storage-wide lock, over the lease
 * coordinator: each store waits out a purge in any window, then shares the lock
 * until what it stored is referred to (REQ-STOR-102, ADR-0020).
 *
 * Where the platform has no coordinator, or refuses the lock, a store shares
 * nothing and goes ahead: a purge of media is refused there for the same reason
 * (`cleanup-running.ts`), so there is nothing to wait out.
 */

import type { MediaSharing } from '@audiogubbins/media-store';

import type { LeaseCoordinator } from './write-lease.js';

/** The sharing a window's media store is made with, over its coordinator. */
export function mediaSharingOf(coordinator: LeaseCoordinator | undefined): MediaSharing {
  return {
    share: async (signal) => {
      if (coordinator === undefined) return () => undefined;
      const locking = await coordinator.lockStorage('shared', {
        wait: true,
        ...(signal === undefined ? {} : { signal }),
      });
      if (locking.kind !== 'held') return () => undefined;
      return () => {
        void locking.release();
      };
    },
  };
}
