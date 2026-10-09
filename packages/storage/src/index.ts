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
 * REQ-STOR-200), forks (REQ-STOR-199) and consolidation; the media store's
 * sharing of the storage-wide lock, which keeps a purge from media another
 * window has stored and not yet referred to; and the model packs a person
 * installs, kept beside the projects through the model packs' store port,
 * counted by usage and offered by a cleanup (ADR-0062).
 *
 * Recording into a project (ADR-0071): a session's audio, arriving through the
 * `CaptureStream` port, committed in chunks as it is made, the session made
 * into an asset and its take when capture ends, every session a crash cut
 * short offered when the project opens and ended only by the person, and the
 * media store's own recovery run apart from them.
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
export {
  type StorageRefusal,
  isStorageFull,
  storageRefusalOf,
  unreadableStateOf,
} from './storage-failures.js';

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
  type ComparedStates,
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

export { retainedMedia } from './media-roots.js';
export { type UnreadableRoot } from './project-roots.js';
export { mediaSharingOf } from './storage-sharing.js';

export {
  type BundleScope,
  type CopyOptions,
  type TreeCopying,
  type TreeSources,
} from './tree-content.js';
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

export {
  type PackUsage,
  type StorageUsage,
  type UsageServices,
  measureUsage,
} from './usage-measurement.js';
export {
  type CleanupChoice,
  type CleanupPlan,
  type CleanupSelection,
  type CleanupStep,
  type CleanupRefusal,
  type MediaRefusal,
  type RecoverabilityLoss,
} from './cleanup-plan.js';
export { type CleanupServices, planCleanup } from './cleanup-planning.js';
export {
  type InstalledPack,
  type PackKept,
  type PackPins,
  type PlannedPack,
} from './pack-cleanup.js';
export { projectPackPins } from './pack-pins.js';
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

export { type MeasuredPack, ModelPackStore } from './model-pack-store.js';
export { type ListedEntry } from './library-entry-files.js';
export { type LibraryServices, ProcessingLibraryStore } from './processing-library-store.js';

export { type VersionChange, takeSourceVersion } from './source-versions.js';
export { type AudioImport, type ImportedAudio, importAudio } from './audio-import.js';
export { type AudioPaste, pasteAudio } from './audio-paste.js';

export { type CaptureStream, type CapturedEvent } from './capture-stream.js';
export { type RecordingFiles } from './recording-manifests.js';
export {
  type CaptureEnded,
  type LostFrames,
  type RecordingProgress,
  type RecordingServices,
  type RecordingSetUp,
  captureInto,
  startRecording,
} from './recording-capture.js';
export {
  type FinishedRecording,
  type FinishingServices,
  finishRecording,
} from './recording-finishing.js';
export { type RecordingCommands, type TakeRequest } from './recording-takes.js';
export { type InterruptedRecording } from './recording-sessions.js';
export { recordingInProgress } from './recording-failures.js';
export { discardRecording, interruptedRecordings, recoverRecording } from './recording-recovery.js';
export { recoverMediaStore } from './media-recovery.js';
export { type Alone } from './storage-sharing.js';
