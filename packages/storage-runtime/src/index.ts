/**
 * The public contract of the AudioGubbins storage runtime.
 *
 * The browser host of project storage (ADR-0022): the storage core runs in one
 * dedicated worker, and the page talks to it through a typed port, whose two
 * sides call each other's operations by one table and send each other events.
 * The page hands the port the worker as an endpoint, and the worker hands it
 * its own global scope. Everything absent from this list is internal and may
 * change without being a breaking change (REQ-REPO-186).
 */

export { type PortEndpoint } from './protocol/port-channel.js';

export { type StorageClient, connectStorage } from './client/storage-client.js';
export { type LibraryClient } from './client/library-client.js';
export { type ProcessingLibraryClient } from './client/processing-library-client.js';
export { type ProjectsClient, type RemoteOpenedProject } from './client/projects-client.js';
export { RemoteProjectSession, RemoteReadOnlyProject } from './client/remote-project.js';
export { type ExportDraft } from './protocol/project-operations.js';
export { type HeldExport, type TransfersClient } from './client/transfers-client.js';
export {
  type BackupsClient,
  type RemoteRestoredBackup,
  type RestoreTarget,
} from './client/backups-client.js';
export {
  type PageBytes,
  type PageFile,
  type PageFolder,
  type PageLocate,
  type PageLocated,
} from './client/page-ports.js';
export { type FolderFile, type HeldFile } from './protocol/page-operations.js';
export { type RootClient } from './client/root-client.js';
export { type SourcesClient } from './client/sources-client.js';
export { type AudioFileImport, type MediaClient } from './client/media-client.js';
export { type RecordingBegin, type RecordingClient } from './client/recording-client.js';
export { type RecordingStatus } from './protocol/recording-operations.js';
export { type CacheClient } from './client/cache-client.js';
export { type PacksClient } from './client/packs-client.js';
export { type PackChange, type PackImport } from './protocol/pack-operations.js';
export { type UsageClient } from './client/usage-client.js';
export { type OwnershipClient } from './client/ownership-client.js';
