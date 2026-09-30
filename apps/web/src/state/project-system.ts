/**
 * The project system started: its stores made from what the browser offers, the
 * storage root opened before anything reads project storage, the list of
 * projects read and the project last open opened again, and what the page does
 * for the open project as it runs (REQ-STOR-052, REQ-STOR-021, REQ-STOR-105,
 * REQ-EXEC-216).
 *
 * Opening the root first is what lets the compatibility screen block before a
 * project is read. A project last open that cannot be opened now is forgotten,
 * and why is logged, rather than tried at every start. While the page runs,
 * hiding it writes a checkpoint of the project open to write, so a tab closed
 * or discarded in the background loses nothing written since, and the
 * application's clock ticks the backup scheduler, which the storage leaves to
 * the application because it keeps no timer. The backups folder kept by this
 * browser is looked for as the page starts, without asking for leave to write
 * into it, which only the person's gesture can.
 */

import {
  missingStorageCapabilities,
  type StorageCapabilityAbsence,
  type StoragePlatform,
} from '@audiogubbins/capabilities';
import type { Clock, DiagnosticCentre } from '@audiogubbins/diagnostics';
import type { PeakCacheStore } from '@audiogubbins/waveform';

import { browserBackupFolder } from '../io/backup-folder.js';
import { browserLinkedFiles } from '../io/linked-files.js';
import { NO_PEAK_CACHE, storedPeakCache } from '../io/stored-peak-cache.js';
import { browserTransferFiles } from '../io/transfer-files.js';
import { projectPlatformOf } from '../storage/project-services.js';
import type { PageVisibility } from './layout-map-watch.js';
import { createProjectStores, startProjects, type ProjectStores } from './project-stores.js';
import type { StateStorage } from './state-storage.js';
import {
  StorageRoot,
  unavailableStorageRoot,
  type StorageRootStore,
} from './storage-root-store.js';

/** How often the backup scheduler is asked whether a generation is due. */
const BACKUP_TICK_MILLISECONDS = 60_000;

/** The project system as the composition root holds it. */
export interface ProjectSystem {
  readonly storageRoot: StorageRootStore;
  readonly projects: ProjectStores | undefined;
  readonly storageAbsences: readonly StorageCapabilityAbsence[];

  /** Where the editor keeps waveform peaks: among the storage's caches (ADR-0043). */
  readonly peakCache: PeakCacheStore;

  /** Stops what the system put on the page. */
  readonly dispose: () => void;
}

/** What starting the system needs from the composition root. */
export interface ProjectSystemNeeds {
  readonly diagnostics: DiagnosticCentre;
  readonly clock: Clock;
  readonly storage: StateStorage;
  readonly page: PageVisibility;
}

/**
 * Starts what the page does for the project system while it runs: opening the
 * root and the project last open, looking for the backups folder, a checkpoint
 * as the page is hidden, and the backup scheduler's tick. Answers what stops
 * the last two.
 */
function run(
  storageRoot: StorageRoot,
  projects: ProjectStores,
  needs: ProjectSystemNeeds,
): () => void {
  const logger = needs.diagnostics.loggerFor('projects');

  // Each runs apart from any command, so a fault in one is logged here, where
  // it would otherwise reach nothing.
  const logFault =
    (what: string) =>
    (error: unknown): void => {
      logger.error(what, { reason: error instanceof Error ? error.message : 'unknown' });
    };
  startProjects(storageRoot, projects, logger).catch(logFault('Projects could not be started.'));
  projects.backupFolder.start().catch(logFault('The backups folder could not be looked for.'));
  const stopWatching = needs.page.listen('visibilitychange', () => {
    if (needs.page.isVisible()) return;
    projects.project.checkpoint().catch(logFault('A checkpoint as the page was hidden failed.'));
  });
  const ticking = setInterval(() => {
    projects.backups.tick().catch(logFault('A scheduled backup failed.'));
  }, BACKUP_TICK_MILLISECONDS);
  return () => {
    stopWatching();
    clearInterval(ticking);
  };
}

/** Makes the project system from what the browser offers, and starts it. */
export function startProjectSystem(
  platform: StoragePlatform,
  needs: ProjectSystemNeeds,
): ProjectSystem {
  const storageAbsences = missingStorageCapabilities(platform);
  const made = projectPlatformOf(platform, needs.diagnostics, needs.clock);
  if (made.kind === 'unavailable') {
    return {
      storageRoot: unavailableStorageRoot(made.reason),
      projects: undefined,
      storageAbsences,
      peakCache: NO_PEAK_CACHE,
      dispose: () => undefined,
    };
  }

  const { services } = made;
  const storageRoot = new StorageRoot(services);
  const files = browserTransferFiles(platform.pickers, services.keeper);
  const projects = createProjectStores(services, needs.storage, {
    files,
    canLink: platform.pickers !== undefined,
    backupFolder: browserBackupFolder(platform.pickers, services.keeper),
    linkedFiles: browserLinkedFiles(services.keeper),
  });
  const stop = run(storageRoot, projects, needs);

  return {
    storageRoot,
    projects,
    storageAbsences,
    peakCache: storedPeakCache({
      ready: () => storageRoot.get().kind === 'ready',
      caches: services.caches,
      digest: services.digest,
    }),
    dispose: () => {
      stop();
      projects.project.dispose();
    },
  };
}
