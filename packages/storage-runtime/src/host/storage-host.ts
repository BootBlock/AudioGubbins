/**
 * The storage worker's service of the page: its end of the port, its loggers,
 * its services made from the parts it was given, and every area's operations
 * served over them (ADR-0022).
 *
 * Apart from reading the platform (`browser-host.ts`), so a test serves the
 * page with the worker's own composition over parts in memory. The parts are
 * made once the loggers are, since the leases and the command bus log.
 */

import type { Clock } from '@audiogubbins/diagnostics';

import { PortChannel, type PortEndpoint } from '../protocol/port-channel.js';
import type { HostChannel } from '../protocol/storage-operations.js';
import { backupHandlers } from './backup-area.js';
import { cacheHandlers } from './cache-area.js';
import { hostLogs } from './host-logs.js';
import { hostServices, type HostLogs, type HostParts } from './host-services.js';
import { libraryHandlers } from './library-area.js';
import { mediaHandlers } from './media-area.js';
import { OpenProjects } from './open-projects.js';
import { ownershipHandlers } from './ownership-area.js';
import { processingLibraryHandlers } from './processing-library-area.js';
import { projectHandlers } from './project-area.js';
import { rootHandlers } from './root-area.js';
import { sourceHandlers } from './source-area.js';
import { transferHandlers } from './transfer-area.js';
import { usageHandlers } from './usage-area.js';

/**
 * Serves the page on the other side of `endpoint`, with the services made from
 * the parts `partsOf` makes with the worker's loggers, whose records are timed
 * by `clock`.
 */
export function serveStorage(
  endpoint: PortEndpoint,
  clock: Clock,
  partsOf: (logs: HostLogs) => HostParts,
): void {
  const channel: HostChannel = new PortChannel(endpoint);
  const services = hostServices(partsOf(hostLogs(channel, clock)));
  const projects = new OpenProjects(channel);
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
    ...usageHandlers(services, projects),
    ...ownershipHandlers(services.coordinator, channel),
  });
}
