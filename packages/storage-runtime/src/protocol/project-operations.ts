/**
 * What the page asks of the projects it opens in the storage worker, and what
 * the worker sends it of each (ADR-0022, REQ-STOR-021, REQ-STOR-098).
 *
 * An open project stays in the worker, named by a handle the page chooses as
 * it opens it, so the page hears the project's stream from before the worker
 * can send on it. Every operation of an open project names its handle and is
 * the session's or the view's own, with the same argument and answer. After
 * each change the worker sends a {@link ProjectUpdate}: what the page needs to
 * make its copy of the project's snapshot again, which is the save status, the
 * access, the history's delta and only what else changed, so the page pays for
 * a change and not for the whole project.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import type {
  CompactionPlan,
  CompactionRequest,
  Comparison,
  ComparisonSource,
  HistoryDelta,
  SideName,
} from '@audiogubbins/history';
import type {
  BackupPolicy,
  ExportRecord,
  HistoryNodeId,
  ProjectState,
  RetentionPolicy,
  SnapshotId,
} from '@audiogubbins/project-format';
import type {
  ChangeOutcome,
  CompactionConfirmation,
  ComparedStates,
  ComparisonOutcome,
  ProjectAccess,
  ProjectRecoveryReport,
  SaveStatus,
  SnapshotRequest,
  TransferAnswer,
  TransferOutcome,
  TransferRequest,
  WriteOutcome,
} from '@audiogubbins/storage';

import type { Operation } from './operations.js';

/** An open project in the worker, as the page names it. */
export type ProjectHandle = number;

/** The comparison of an update: one opened or changed, or none any longer. */
export type ComparisonUpdate =
  { readonly kind: 'open'; readonly comparison: Comparison } | { readonly kind: 'closed' };

/**
 * What changed in an open project since the update before. A member absent is
 * unchanged; the save status and the access are always sent, being small.
 */
export interface ProjectUpdate {
  readonly save: SaveStatus;
  readonly access: ProjectAccess;
  readonly history: HistoryDelta;
  readonly state?: ProjectState;
  readonly exports?: readonly ExportRecord[];
  readonly retention?: RetentionPolicy;
  readonly backup?: BackupPolicy;
  readonly comparison?: ComparisonUpdate;
}

/** The update a project opens with: its history from none, and everything else. */
export interface FirstUpdate extends ProjectUpdate {
  readonly state: ProjectState;
  readonly exports: readonly ExportRecord[];
  readonly retention: RetentionPolicy;
  readonly backup: BackupPolicy;
}

/**
 * A project the worker holds under a handle, as it began to be held: its first
 * update, whose history is the last of its slices, and how many slices of the
 * history were sent on the handle's opening stream before it.
 */
export interface HeldOpening {
  readonly first: FirstUpdate;
  readonly slices: number;
}

/** A project opened in the worker: how, what recovery found, and the project as it opened. */
export interface ProjectOpening extends HeldOpening {
  readonly kind: 'writable' | 'read-only';
  readonly report: ProjectRecoveryReport;
}

/**
 * An export to record, as the page knows it: the worker gives it its
 * identifier and its time, as it does every other event it records.
 */
export type ExportDraft = Omit<ExportRecord, 'id' | 'at'>;

/** An operation of the open project a handle names. */
type Of<TArgument, TAnswer> = Operation<{ readonly handle: ProjectHandle } & TArgument, TAnswer>;

/** An operation of an open project that only moves or keeps, answered with how it was written. */
type Written<TArgument = unknown> = Of<TArgument, DomainResult<WriteOutcome>>;

/** The operations of the projects the page opens. */
export type ProjectOperations = {
  /** Opens a project under a handle the page has not used before. */
  'projects.open': Of<
    { readonly project: ProjectId; readonly access: 'write' | 'read'; readonly steal?: boolean },
    DomainResult<ProjectOpening>
  >;

  /**
   * Closes the project a handle names where it was opened after all, once
   * the page abandoned its opening; nothing where it was not.
   */
  'projects.abandon': Of<unknown, undefined>;

  /** Closes a project open to write, which releases its handle once it is closed. */
  'projects.close': Of<unknown, DomainResult<void>>;

  /** Closes a project open to read, which releases its handle. */
  'projects.closeView': Of<unknown, undefined>;

  'projects.run': Of<{ readonly invocation: CommandInvocation }, DomainResult<ChangeOutcome>>;
  /** Runs several commands as one change, which undo reverses whole. */
  'projects.runGroup': Of<
    {
      readonly description: string;
      readonly invocations: readonly [CommandInvocation, ...CommandInvocation[]];
    },
    DomainResult<ChangeOutcome>
  >;
  'projects.undo': Written;
  'projects.redo': Written;
  'projects.goTo': Written<{ readonly node: HistoryNodeId }>;
  'projects.nameBranch': Written<{
    readonly node: HistoryNodeId;
    readonly name: string | undefined;
  }>;
  'projects.createSnapshot': Written<{ readonly request: SnapshotRequest }>;
  'projects.deleteSnapshot': Written<{ readonly snapshot: SnapshotId }>;
  'projects.recordExport': Written<{ readonly draft: ExportDraft }>;
  'projects.compare': Of<
    { readonly a: ComparisonSource; readonly b: ComparisonSource },
    DomainResult<ComparisonOutcome>
  >;
  'projects.comparedDifference': Of<unknown, DomainResult<ComparedStates>>;
  'projects.switchSide': Written<{ readonly side: SideName | undefined }>;
  'projects.closeComparison': Written;
  'projects.promote': Written<{ readonly side: SideName }>;
  'projects.planCompaction': Of<
    { readonly request: CompactionRequest },
    DomainResult<CompactionPlan>
  >;
  'projects.compactHistory': Written<{
    readonly plan: CompactionPlan;
    readonly confirmation: CompactionConfirmation;
  }>;
  'projects.setRetentionPolicy': Written<{
    readonly policy: RetentionPolicy;
    readonly confirmation: CompactionConfirmation | undefined;
  }>;
  'projects.setBackupPolicy': Written<{ readonly policy: BackupPolicy }>;
  'projects.checkpoint': Written;
  'projects.retry': Of<unknown, SaveStatus>;
  'projects.answerTransfer': Of<
    { readonly request: TransferRequest; readonly answer: TransferAnswer },
    DomainResult<void>
  >;

  /** Asks the window writing a project open to read to hand it over. */
  'projects.requestTransfer': Of<unknown, DomainResult<TransferOutcome>>;
};

/** The stream of an open project's updates. */
export type ProjectStream = `project:${string}`;

/** The name of the stream the updates of the project open under `handle` are sent on. */
export function projectStream(handle: ProjectHandle): ProjectStream {
  return `project:${String(handle)}`;
}

/**
 * The stream of the slices of a project's history sent as it opens, each a
 * delta from the slices before it, so no one message holds a long history.
 */
export type OpeningStream = `opening:${string}`;

/** The name of the stream the history of the project opening under `handle` is sliced on. */
export function openingStream(handle: ProjectHandle): OpeningStream {
  return `opening:${String(handle)}`;
}
