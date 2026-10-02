/**
 * The public contract of AudioGubbins project storage.
 *
 * The keeping of projects over the storage tree port (ADR-0020): the storage
 * root and its pre-1.0 compatibility flow (REQ-STOR-052), the catalogue of
 * projects, the `ProjectRepository`; the journal of history events, the
 * `CommandJournal`; the states kept whole, the `SnapshotStore`; the checkpoint
 * and double-head protocol with recovery from a torn tail (REQ-STOR-101); the
 * project session, through which every change to an open project is made and
 * written at once (REQ-STOR-021); and the `ProjectWriteLease` contract that
 * lets one window at a time write a project, fenced by epochs in storage
 * (REQ-STOR-098).
 *
 * Around the kept projects: the portable bundle and the unpacked tree a project
 * is taken out as and brought in from (REQ-STOR-099, REQ-STOR-103), backup
 * generations, the scheduler that makes them and their restoring
 * (REQ-STOR-105), disposable caches (REQ-STOR-027), usage by category, history
 * compaction, and a cleanup planned in the safest order and carried out only
 * with the person's confirmation (REQ-STOR-055, REQ-STOR-102, REQ-STOR-106,
 * REQ-STOR-200), forks (REQ-STOR-199) and consolidation; and the media store's
 * sharing of the storage-wide lock, which keeps a purge from media another
 * window has stored and not yet referred to.
 *
 * The package reaches no browser or Node global: the tree, the digest, the
 * clock, the identifiers, the command bus and the lease coordination are
 * injected, so every rule here is tested without a browser. Everything absent
 * from this list is internal and may change without being a contract change
 * (REQ-REPO-186).
 */

export {
  type StorageRootOpening,
  type StoredSchema,
  type WipeConfirmation,
  openStorageRoot,
  wipeStorage,
} from './storage-root.js';
export { exportRawStorage } from './raw-export.js';
export { MEDIA_DIRECTORY } from './storage-layout.js';

export { type RecordFault } from './checked-records.js';
export { isStorageFull } from './storage-failures.js';

export {
  type CatalogueEntry,
  type CatalogueServices,
  type NewProject,
  ProjectRepository,
  type PurgeProjectConfirmation,
} from './project-catalogue.js';
export { type ImportOrigin, type ProjectHeader } from './project-header.js';

export {
  type OpenedProject,
  type OpeningRequest,
  type OpeningServices,
  openProject,
} from './project-opening.js';
export { ProjectSession } from './project-session.js';
export {
  type ChangeOutcome,
  type ComparisonOutcome,
  DEFAULT_CADENCE,
  type SessionCadence,
  type SnapshotRequest,
} from './session-contracts.js';
export { ReadOnlyProject, type ReadOnlyServices } from './read-only-project.js';
export {
  type ProjectAccess,
  type ProjectSnapshot,
  type ReadOnlyReason,
} from './project-snapshot.js';
export { type ProjectModel } from './project-model.js';
export { type SaveStatus, type WriteOutcome } from './write-queue.js';

export {
  type HeadFallback,
  type HeadFallbackReason,
  type ProjectRecoveryReport,
} from './project-recovery.js';
export { type BreakReason, type CommandJournal, type JournalBreak } from './command-journal.js';
export { type JournalPosition } from './journal-position.js';
export { type SnapshotStore } from './state-store.js';

export {
  type LeaseAcquisition,
  type LeaseCoordinator,
  type LeaseLoss,
  type LeaseOwner,
  type OwnershipEvent,
  type ProjectWriteLease,
  type StorageLockMode,
  type StorageLocking,
  type TransferAnswer,
  type TransferOutcome,
  type TransferRequest,
} from './write-lease.js';

export { type UnreadableRoot, retainedMedia } from './media-roots.js';
export { mediaSharingOf } from './storage-sharing.js';

export { type BundleScope, type CopyOptions, type TreeSources } from './tree-content.js';
export {
  type ExportAttempt,
  type ExportFrom,
  type ExportServices,
  type ExportSource,
  type ExportedBundle,
  exportBackup,
  exportBundle,
  exportUnpacked,
  importBundle,
  importUnpacked,
} from './project-transfer.js';
export { type ImportServices } from './tree-import.js';
export { type ImportIdentity, type ImportedProject } from './import-claim.js';
export { packUnpacked, unpackBundle } from './bundle-conversion.js';
export {
  type AnotherProject,
  type DirectoryClaim,
  type DirectoryFile,
  type DirectoryReader,
  type DirectoryWriter,
  anotherProjectIn,
} from './project-directory.js';

export {
  CACHE_CLEANUP_ORDER,
  CacheCategory,
  type CacheEntry,
  type CacheKey,
  type CacheScope,
  CacheStore,
  unstoredScope,
} from './cache-store.js';

export {
  type BackupGeneration,
  type BackupPruning,
  type BackupReason,
  planBackupPruning,
} from './backup-planning.js';
export { BackupGenerations, type GenerationListing } from './backup-generations.js';
export {
  type BackupServices,
  type BackupTick,
  BackupScheduler,
  type ExternalBackupTarget,
  type ExternalCopy,
} from './backup-scheduler.js';

export { type StorageUsage, type UsageServices, measureUsage } from './usage-measurement.js';
export {
  type CleanupChoice,
  type CleanupPlan,
  type CleanupSelection,
  type CleanupServices,
  type CleanupStep,
  type CleanupRefusal,
  type RecoverabilityLoss,
  planCleanup,
} from './cleanup-planning.js';
export {
  type CleanupConfirmation,
  type CleanupRunOptions,
  type CleanupRunServices,
  type StepOutcome,
  runCleanup,
} from './cleanup-running.js';
export { type PressureRelief, relieveStoragePressure } from './storage-pressure.js';

export {
  type RestoreServices,
  type RestoreTarget,
  type RestoredBackup,
  restoreBackup,
} from './backup-restoring.js';
export { type CompactionConfirmation } from './history-compaction.js';

export {
  type ForkPoint,
  type ForkRequest,
  type ForkServices,
  forkProject,
} from './project-fork.js';
export {
  type AssetConsolidation,
  type ConsolidationServices,
  type LocatedFile,
  type PassedOverReason,
  consolidate,
} from './consolidation.js';
