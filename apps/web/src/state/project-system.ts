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
 * into it, which only the person's gesture can. Taking the system down gives
 * up every piece of work it started in the storage worker.
 */

import {
  missingStorageCapabilities,
  type StorageCapabilityAbsence,
  type StoragePlatform,
} from '@audiogubbins/capabilities';
import type { DiagnosticCentre } from '@audiogubbins/diagnostics';
import type { StorageClient } from '@audiogubbins/storage-runtime';
import type { PeakCacheStore } from '@audiogubbins/waveform';

import { browserBackupFolder } from '../io/backup-folder.js';
import { browserLinkedFiles } from '../io/linked-files.js';
import { NO_PEAK_CACHE, storedPeakCache } from '../io/stored-peak-cache.js';
import { browserTransferFiles } from '../io/transfer-files.js';
import { projectPlatformOf, type ProjectServices } from '../storage/project-services.js';
import { abandonment, isAbandoned } from './abandoning.js';
import type { PageVisibility } from './layout-map-watch.js';
import {
  createProjectStores,
  startProjects,
  type ProjectPorts,
  type ProjectStores,
} from './project-stores.js';
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

  /**
   * The storage worker's client, for what keeps its own state there beside the
   * projects, as the model packs do; absent where projects cannot be kept.
   */
  readonly storage: StorageClient | undefined;

  /** Stops what the system put on the page. */
  readonly dispose: () => void;
}

/** What starting the system needs from the composition root. */
export interface ProjectSystemNeeds {
  readonly diagnostics: DiagnosticCentre;
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
      // Work given up for newer work, or as the page goes, is no fault.
      if (isAbandoned(error)) return;
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
  const made = projectPlatformOf(platform, needs.diagnostics);
  if (made.kind === 'unavailable') {
    return {
      storageRoot: unavailableStorageRoot(made.reason),
      projects: undefined,
      storageAbsences,
      peakCache: NO_PEAK_CACHE,
      storage: undefined,
      dispose: () => undefined,
    };
  }

  const { services } = made;
  const ports: ProjectPorts = {
    files: browserTransferFiles(platform.pickers, services.keeper),
    canLink: platform.pickers !== undefined,
    backupFolder: browserBackupFolder(platform.pickers, services.keeper),
    linkedFiles: browserLinkedFiles(services.keeper),
  };
  return { ...projectSystemOver(services, ports, needs), storageAbsences };
}

/**
 * The project system over the storage `services` reach and the page's `ports`,
 * started: the root opened, the stores made, and the peak cache kept to a root
 * that is ready.
 */
export function projectSystemOver(
  services: ProjectServices,
  ports: ProjectPorts,
  needs: ProjectSystemNeeds,
): Omit<ProjectSystem, 'storageAbsences'> {
  const lifetime = new AbortController();
  const storageRoot = new StorageRoot(services.client.root, lifetime.signal);
  const projects = createProjectStores(services, needs.storage, ports, lifetime.signal);
  const stop = run(storageRoot, projects, needs);

  return {
    storageRoot,
    projects,
    peakCache: storedPeakCache({
      ready: () => storageRoot.get().kind === 'ready',
      caches: services.client.caches,
      digest: services.digest,
    }),
    storage: services.client,
    dispose: () => {
      stop();
      lifetime.abort(abandonment('The page took the project system down.'));
      projects.project.dispose();
    },
  };
}
