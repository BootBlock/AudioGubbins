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
import { cleanAtStart, type StartUpCleaning } from '@audiogubbins/storage';

import { PortChannel, type PortEndpoint } from '../protocol/port-channel.js';
import type { HostChannel } from '../protocol/storage-operations.js';
import { backupHandlers } from './backup-area.js';
import { cacheHandlers } from './cache-area.js';
import { hostLogs } from './host-logs.js';
import { hostServices, type HostLogs, type HostParts, type HostServices } from './host-services.js';
import { CodecWorkerLink } from './codec-worker-link.js';
import { exportHandlers } from './export-area.js';
import { importHandlers } from './import-area.js';
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
 * by `clock`, and cleans what a crash or another window left as the worker
 * starts.
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
  const codecs = new CodecWorkerLink();
  cleanStorage(services, logs);
  channel.serve({
    ...libraryHandlers(services),
    ...processingLibraryHandlers(services),
    ...projectHandlers(services, projects),
    ...transferHandlers(services, projects, channel),
    ...backupHandlers(services, projects, channel),
    ...rootHandlers(services, channel),
    ...sourceHandlers(services, projects, channel),
    ...mediaHandlers(services, projects, channel),
    ...importHandlers(services, projects, channel, codecs),
    ...exportHandlers(services, projects, channel),
    ...cacheHandlers(services),
    ...packHandlers(services, channel),
    ...usageHandlers(services, projects),
    ...ownershipHandlers(services.coordinator, channel),
    ...recordingHandlers(services, projects, channel),
  });
}

/**
 * Undoes what a crash left of the media store's writing (ADR-0071) and removes
 * what a window left staged, a rendition it was decoding or an export it had
 * not delivered (ADR-0090, ADR-0092), once, as the worker starts and before it
 * stores anything, and says what came of it (`start-up-cleaning.ts` in the
 * storage). Where another window is storing or staging, nothing is undone or
 * removed this time.
 */
function cleanStorage(services: HostServices, logs: HostLogs): void {
  void cleanAtStart(services).then((alone) => {
    if (alone.kind !== 'done') {
      logs
        .loggerFor('storage')
        .debug(
          'The storage was not cleaned at start: another window is storing or staging, or windows cannot be told apart.',
          { reason: alone.kind },
        );
      return;
    }
    reportRecovery(alone.value.recovered, logs.loggerFor('media'));
    reportStaging(alone.value.staging, logs.loggerFor('storage'));
  });
}

/** Says what the media store's recovery came to. */
function reportRecovery(recovered: StartUpCleaning['recovered'], logger: Logger): void {
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
}

/**
 * Says where the staging could not be removed: nothing depends on it, so the
 * worker goes on, and a later start removes it.
 */
function reportStaging(staging: StartUpCleaning['staging'], logger: Logger): void {
  if (staging.kind === 'failed') {
    logger.warning('The staging could not be cleared.', { kind: staging.reason });
  }
}
