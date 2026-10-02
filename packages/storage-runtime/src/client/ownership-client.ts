/**
 * Who writes each project, as the page asks the storage worker, whose write
 * leases they are (REQ-STOR-098).
 */

import type { ProjectId } from '@audiogubbins/domain';
import type { LeaseOwner, OwnershipEvent } from '@audiogubbins/storage';

import { ownershipStream, type ClientChannel } from '../protocol/storage-operations.js';

/** Who writes a project, and each change of it. */
export interface OwnershipClient {
  /** The window writing a project, where one does and can be told. */
  ownerOf(project: ProjectId): Promise<LeaseOwner | undefined>;

  /**
   * Calls `listener` with each change of the project's writer, and each
   * checkpoint it writes, from once this settles until the call it settles
   * with, which settles once the worker stops sending them for this listener.
   */
  watch(
    project: ProjectId,
    listener: (event: OwnershipEvent) => void,
  ): Promise<() => Promise<void>>;
}

/** Who writes each project, over the page's end of the port. */
export function ownershipClient(channel: ClientChannel): OwnershipClient {
  return {
    ownerOf: (project) => channel.call('ownership.ownerOf', project),
    watch: async (project, listener) => {
      // Heard from before the worker is asked, so no change it sends once it
      // watches is missed.
      const stopHearing = channel.listen(ownershipStream(project), listener);
      try {
        await channel.call('ownership.subscribe', project);
      } catch (error) {
        // The worker watches nothing for this listener, so it hears nothing.
        stopHearing();
        throw error;
      }
      let stopped = false;
      return async () => {
        // Once only, since the worker counts this listener once.
        if (stopped) return;
        stopped = true;
        stopHearing();
        await channel.call('ownership.unsubscribe', project);
      };
    },
  };
}
