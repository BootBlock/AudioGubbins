/**
 * The page's client of the storage worker: a typed facade for each kind of
 * thing the application's stores ask of project storage, over the page's end
 * of the port (ADR-0022).
 *
 * Each facade's long operations take a signal, which reaches the worker's work
 * and settles the call once the worker has stopped, or with its answer where
 * it had finished first, and a refusal of the storage tree rejects with
 * the same `TreeFailure` it was in the worker. The page serves the worker's
 * calls on the ports its facades lend (`page-ports.ts`). The records the
 * worker's loggers make are admitted into the page's diagnostics, under their
 * own categories, by the page's verbosity.
 */

import type { DiagnosticCentre } from '@audiogubbins/diagnostics';

import { PortChannel, type PortEndpoint } from '../protocol/port-channel.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import { backupsClient, type BackupsClient } from './backups-client.js';
import { cacheClient, type CacheClient } from './cache-client.js';
import { libraryClient, type LibraryClient } from './library-client.js';
import { mediaClient, type MediaClient } from './media-client.js';
import { ownershipClient, type OwnershipClient } from './ownership-client.js';
import { PagePorts, lendingCall } from './page-ports.js';
import { handleCounter, projectsClient, type ProjectsClient } from './projects-client.js';
import { rootClient, type RootClient } from './root-client.js';
import { sourcesClient, type SourcesClient } from './sources-client.js';
import { transfersClient, type TransfersClient } from './transfers-client.js';
import { usageClient, type UsageClient } from './usage-client.js';

/** What the page asks of project storage, by area. */
export interface StorageClient {
  readonly library: LibraryClient;
  readonly projects: ProjectsClient;
  readonly transfers: TransfersClient;
  readonly backups: BackupsClient;
  readonly root: RootClient;
  readonly sources: SourcesClient;
  readonly media: MediaClient;
  readonly caches: CacheClient;
  readonly usage: UsageClient;
  readonly ownership: OwnershipClient;
}

/**
 * The client of the storage worker on the other side of `endpoint`, the
 * worker's records admitted into `diagnostics`.
 */
export function connectStorage(
  endpoint: PortEndpoint,
  diagnostics: Pick<DiagnosticCentre, 'relay'>,
): StorageClient {
  return storageClientOver(new PortChannel(endpoint), new PagePorts(), diagnostics);
}

/**
 * The client over the page's end of the port, serving the worker's calls on
 * the ports `ports` lends, which a test counts.
 */
export function storageClientOver(
  channel: ClientChannel,
  ports: PagePorts,
  diagnostics: Pick<DiagnosticCentre, 'relay'>,
): StorageClient {
  channel.serve(ports.handlers());
  const lending = lendingCall(channel, ports);
  const nextHandle = handleCounter();
  channel.listen('log', (entry) => {
    if (entry.kind === 'record') diagnostics.relay.write(entry.record);
    else diagnostics.relay.writePerformance(entry.record);
  });
  return {
    library: libraryClient(channel),
    projects: projectsClient(channel, nextHandle),
    transfers: transfersClient(lending),
    backups: backupsClient(channel, lending, nextHandle),
    root: rootClient(channel, lending),
    sources: sourcesClient(lending),
    media: mediaClient(channel, lending),
    caches: cacheClient(channel),
    usage: usageClient(channel),
    ownership: ownershipClient(channel),
  };
}
