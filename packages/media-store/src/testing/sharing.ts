/**
 * A sharing of the storage-wide lock for tests of one window's store: it counts
 * the shares taken and not yet ended, so a test can see a store share the lock
 * for exactly as long as it holds what it stored, and it can be closed to
 * stores, as a purge in another window closes it, until it is opened again.
 */

import type { MediaSharing } from '../object-store.js';

/** A sharing that counts its shares and can be closed to new ones. */
export interface CountedSharing extends MediaSharing {
  /** The shares taken and not yet ended. */
  readonly active: number;

  /** Keeps every new share waiting, as a purge does, until {@link open} is called. */
  close(): void;
  open(): void;
}

export function countedSharing(): CountedSharing {
  let active = 0;
  let waiting: (() => void)[] | undefined;
  const ended = (): (() => void) => {
    active += 1;
    let over = false;
    return () => {
      if (!over) active -= 1;
      over = true;
    };
  };
  return {
    get active() {
      return active;
    },
    close: () => {
      waiting ??= [];
    },
    open: () => {
      const granted = waiting ?? [];
      waiting = undefined;
      for (const grant of granted) grant();
    },
    share: async (signal) => {
      signal?.throwIfAborted();
      const queue = waiting;
      if (queue !== undefined) {
        await new Promise<void>((resolve) => {
          queue.push(resolve);
        });
      }
      return ended();
    },
  };
}
