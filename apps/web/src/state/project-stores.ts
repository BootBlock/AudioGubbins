/**
 * The stores of the project system, made together over one storage (ADR-0011,
 * REQ-STOR-021).
 *
 * Each store is a partition of its own, with its own typed operations, and none
 * reaches another except through the ones it is given here. A project opened to
 * write has its linked files looked at as it opens, so a change to one is put
 * to the person at once (REQ-STOR-053).
 */

import type { Logger } from '@audiogubbins/diagnostics';

import type { BackupFolderPort } from '../io/backup-folder.js';
import type { LinkedFilesPort } from '../io/linked-files.js';
import type { TransferFiles } from '../io/transfer-files.js';
import type { ProjectServices } from '../storage/project-services.js';
import { BackupFolderStore } from './backup-folder-store.js';
import { BackupStore } from './backup-store.js';
import { ExportRecorder } from './export-recorder.js';
import { HistoryReviewStore } from './history-review-store.js';
import { OpenProjectStore } from './open-project-store.js';
import { relieveWhenFull } from './pressure-relief.js';
import { checkSourcesOnOpening, keepListInStep } from './project-follow-ups.js';
import { ProjectLibraryStore } from './project-library-store.js';
import {
  createProjectPreferencesStore,
  type ProjectPreferencesStore,
} from './project-preferences-store.js';
import { ProjectTransferStore } from './project-transfer-store.js';
import { SourceChangeStore } from './source-change-store.js';
import type { StateStorage } from './state-storage.js';
import type { StorageRootStore } from './storage-root-store.js';
import { StorageUsageStore } from './storage-usage-store.js';

/** Every store of the project system, and the files it passes to and from the person. */
export interface ProjectStores {
  readonly library: ProjectLibraryStore;
  readonly transfer: ProjectTransferStore;
  readonly project: OpenProjectStore;
  readonly review: HistoryReviewStore;
  readonly usage: StorageUsageStore;
  readonly backups: BackupStore;
  readonly backupFolder: BackupFolderStore;
  readonly sources: SourceChangeStore;
  readonly preferences: ProjectPreferencesStore;
  readonly files: TransferFiles;
}

/** What the browser gives the stores beyond its storage. */
export interface ProjectPorts {
  /** The files passed to and from the person. */
  readonly files: TransferFiles;

  /** Whether the browser gives files it lets AudioGubbins find again, which only the pickers do. */
  readonly canLink: boolean;

  /** The backups folder, absent where the browser gives none. */
  readonly backupFolder: BackupFolderPort | undefined;

  /** The files linked assets were recorded from, found again. */
  readonly linkedFiles: LinkedFilesPort;
}

/** Makes the stores over the storage and the browser's `ports`, each once. */
export function createProjectStores(
  services: ProjectServices,
  storage: StateStorage,
  ports: ProjectPorts,
): ProjectStores {
  const { files, linkedFiles } = ports;
  const preferences = createProjectPreferencesStore(storage, ports.canLink, services.logger);
  const library = new ProjectLibraryStore(services);
  const project = new OpenProjectStore(services, preferences);
  const sources = new SourceChangeStore(services, project, files, linkedFiles);
  const backupFolder = new BackupFolderStore(ports.backupFolder, services.logger);

  relieveWhenFull(project, services.caches, services.logger);

  checkSourcesOnOpening(project, sources, services.logger);
  keepListInStep(project, library, services.logger);

  return {
    library,
    transfer: new ProjectTransferStore(
      services,
      files,
      linkedFiles,
      library,
      project,
      new ExportRecorder(services, project),
    ),
    project,
    review: new HistoryReviewStore(project),
    usage: new StorageUsageStore(services, project),
    backups: new BackupStore(services, project, library, backupFolder.target),
    backupFolder,
    sources,
    preferences,
    files,
  };
}

/** Opens the root, and where it can be read, lists the projects and opens the one last open. */
export async function startProjects(
  root: StorageRootStore,
  stores: ProjectStores,
  logger: Logger,
): Promise<void> {
  const opened = await root.open();
  if (!opened.ok || !opened.value) return;
  await stores.library.refresh();
  const last = stores.preferences.get().lastProject;
  if (last === undefined) return;
  const reopened = await stores.project.open(last);
  if (!reopened.ok) {
    logger.info('The project last open could not be opened again.', {
      code: reopened.failures[0].code,
    });
    stores.preferences.remember(undefined);
  }
}
