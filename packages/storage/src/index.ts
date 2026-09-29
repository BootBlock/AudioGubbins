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
 * The package reaches no browser or Node global: the tree, the digest, the
 * clock, the identifiers, the command bus and the lease coordination are
 * injected, so every rule here is tested without a browser. Everything absent
 * from this list is internal and may change without being a contract change
 * (REQ-REPO-186).
 */

export {
  type StorageRootOpening,
  type WipeConfirmation,
  openStorageRoot,
  wipeStorage,
} from './storage-root.js';
export { exportRawStorage } from './raw-export.js';

export { type RecordFault } from './checked-records.js';

export {
  type CatalogueEntry,
  type CatalogueServices,
  type NewProject,
  ProjectRepository,
  type PurgeProjectConfirmation,
} from './project-catalogue.js';
export { type ProjectHeader } from './project-header.js';

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
export { ReadOnlyProject } from './read-only-project.js';
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
  type BackupPolicy,
  type BackupRetention,
  type BackupTrigger,
  DEFAULT_BACKUP_POLICY,
} from './backup-policy.js';

export {
  type LeaseAcquisition,
  type LeaseCoordinator,
  type LeaseLoss,
  type LeaseOwner,
  type ProjectWriteLease,
  type TransferAnswer,
  type TransferRequest,
} from './write-lease.js';

export { type UnreadableRoot, retainedMedia } from './media-roots.js';
