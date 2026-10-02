/**
 * Following a project this tab handed over until the tab it went to holds it,
 * as the storage worker hears the leases change (REQ-STOR-098, REQ-STOR-101).
 *
 * Opened again before then, this tab could take back what it had just handed
 * over, so it waits for the other tab to take the lease, and then reads the
 * project, naming that tab and following its changes. The other tab may have
 * taken it before this tab began to watch, so once the watch is under way the
 * worker is asked who holds it.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { ProjectId } from '@audiogubbins/domain';
import type { OwnershipClient } from '@audiogubbins/storage-runtime';

/** A fault of the watch, which runs apart from any command and so is logged here. */
function logged(logger: Logger, what: string): (error: unknown) => void {
  return (error) => {
    logger.error(what, { reason: error instanceof Error ? error.message : 'unknown' });
  };
}

/**
 * Calls `held` once another tab holds `project`, and answers what stops
 * following it, which a call to `held` has already done.
 */
export function followHandover(
  ownership: OwnershipClient,
  project: ProjectId,
  held: () => void,
  logger: Logger,
): () => void {
  let following = true;
  let stopWatching: (() => Promise<void>) | undefined;
  const stop = (): void => {
    if (!following) return;
    following = false;
    stopWatching?.().catch(logged(logger, 'A project handed over could not stop being watched.'));
  };
  const found = (): void => {
    if (!following) return;
    stop();
    held();
  };
  ownership
    .watch(project, (event) => {
      if (event.kind === 'acquired') found();
    })
    .then(async (stopping) => {
      stopWatching = stopping;
      if (!following) {
        // Stopped while the worker began to watch, which now watches for nothing.
        await stopping();
        return;
      }
      if ((await ownership.ownerOf(project)) !== undefined) found();
    })
    .catch(logged(logger, 'The tab a project went to could not be asked for.'));
  return stop;
}
