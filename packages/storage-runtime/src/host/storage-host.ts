/**
 * The storage worker's service of the page: its end of the port, its loggers,
 * its services made from the parts it was given, and every area's operations
 * served over them (ADR-0022).
 *
 * Apart from reading the platform (`browser-host.ts`), so a test serves the
 * page with the worker's own composition over parts in memory. The parts are
 * made once the loggers are, since the leases and the command bus log.
 */

import type { Clock, Logger } from '@audiogubbins/diagnostics';
import { recoverMediaStore } from '@audiogubbins/storage';

import { PortChannel, type PortEndpoint } from '../protocol/port-channel.js';
import type { HostChannel } from '../protocol/storage-operations.js';
import { backupHandlers } from './backup-area.js';
import { cacheHandlers } from './cache-area.js';
import { hostLogs } from './host-logs.js';
import { hostServices, type HostLogs, type HostParts, type HostServices } from './host-services.js';
import { libraryHandlers } from './library-area.js';
import { mediaHandlers } from './media-area.js';
import { OpenProjects } from './open-projects.js';
import { ownershipHandlers } from './ownership-area.js';
import { packHandlers } from './pack-area.js';
import { processingLibraryHandlers } from './processing-library-area.js';
import { recordingHandlers } from './recording-area.js';
import { projectHandlers } from './project-area.js';
import { rootHandlers } from './root-area.js';
import { sourceHandlers } from './source-area.js';
import { transferHandlers } from './transfer-area.js';
import { usageHandlers } from './usage-area.js';

/**
 * Serves the page on the other side of `endpoint`, with the services made from
 * the parts `partsOf` makes with the worker's loggers, whose records are timed
 * by `clock`, and runs the media store's recovery as the worker starts.
 */
export function serveStorage(
  endpoint: PortEndpoint,
  clock: Clock,
  partsOf: (logs: HostLogs) => HostParts,
): void {
  const channel: HostChannel = new PortChannel(endpoint);
  const logs = hostLogs(channel, clock);
  const services = hostServices(partsOf(logs));
  const projects = new OpenProjects(channel);
  recoverMedia(services, logs.loggerFor('media'));
  channel.serve({
    ...libraryHandlers(services),
    ...processingLibraryHandlers(services),
    ...projectHandlers(services, projects),
    ...transferHandlers(services, projects, channel),
    ...backupHandlers(services, projects, channel),
    ...rootHandlers(services, channel),
    ...sourceHandlers(services, projects, channel),
    ...mediaHandlers(services, projects, channel),
    ...cacheHandlers(services),
    ...packHandlers(services, channel),
    ...usageHandlers(services, projects),
    ...ownershipHandlers(services.coordinator, channel),
    ...recordingHandlers(services, projects, channel),
  });
}

/**
 * Undoes what a crash left of the media store's writing, once, as the worker
 * starts and before it stores anything (ADR-0071), and says what came of it
 * (`media-recovery.ts` in the storage).
 */
function recoverMedia(services: HostServices, logger: Logger): void {
  void recoverMediaStore(services.store, services.coordinator).then((alone) => {
    if (alone.kind !== 'done') {
      logger.debug(
        'The media store was not recovered: another window is storing media, or windows cannot be told apart.',
        { reason: alone.kind },
      );
      return;
    }
    const recovered = alone.value;
    if (!recovered.ok) {
      logger.warning('The media store could not be recovered.', {
        code: recovered.failures[0].code,
      });
      return;
    }
    const undone = recovered.value.undone.length;
    // A start with nothing to undo is the usual one, and says nothing worth keeping.
    if (undone === 0) logger.debug('The media store had nothing to recover.');
    else logger.info('The media store undid what a crash left of its writing.', { count: undone });
  });
}
