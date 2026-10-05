/**
 * A project open in the storage worker, as the page holds it: open to write,
 * or to read, with the members the application uses of the session and the
 * view it stands for, each a property so none is held unbound (ADR-0022,
 * REQ-STOR-021, REQ-STOR-098).
 *
 * Each operation is the worker's session's own, by the project's handle, and
 * settles once the worker answers, by when the update its change sent has
 * arrived ahead of the answer and the snapshot read here shows it. There is
 * one of these for each project the page opens, so a page comparing what it
 * holds by identity finds the one it opened. An export is recorded without an
 * identifier or a time: the worker gives it both (`session-area.ts`).
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import type {
  CompactionPlan,
  CompactionRequest,
  ComparisonSource,
  SideName,
} from '@audiogubbins/history';
import type {
  BackupPolicy,
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
  ProjectSnapshot,
  SaveStatus,
  SnapshotRequest,
  TransferAnswer,
  TransferOutcome,
  TransferRequest,
  WriteOutcome,
} from '@audiogubbins/storage';

import type { ExportDraft, ProjectHandle } from '../protocol/project-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import type { ProjectMirror } from './project-mirror.js';

/** What a project open in the worker is held with on the page. */
export interface RemoteParts {
  readonly channel: ClientChannel;
  readonly handle: ProjectHandle;
  readonly mirror: ProjectMirror;

  /** Stops hearing the project's updates. */
  readonly stopHearing: () => void;
}

/** A project open to write in the worker (see the module comment). */
export class RemoteProjectSession {
  readonly project: ProjectId;

  /** The project's handle in the worker, which a cleanup names the project it holds by. */
  readonly handle: ProjectHandle;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ProjectSnapshot;
  readonly #channel: ClientChannel;
  readonly #stopHearing: () => void;

  constructor(parts: RemoteParts) {
    this.project = parts.mirror.getSnapshot().project;
    this.handle = parts.handle;
    this.subscribe = parts.mirror.subscribe;
    this.getSnapshot = parts.mirror.getSnapshot;
    this.#channel = parts.channel;
    this.#stopHearing = parts.stopHearing;
  }

  readonly run = (invocation: CommandInvocation): Promise<DomainResult<ChangeOutcome>> =>
    this.#channel.call('projects.run', { handle: this.handle, invocation });

  /** Runs several commands as one change, which undo reverses whole. */
  readonly runGroup = (
    description: string,
    invocations: readonly [CommandInvocation, ...CommandInvocation[]],
  ): Promise<DomainResult<ChangeOutcome>> =>
    this.#channel.call('projects.runGroup', { handle: this.handle, description, invocations });

  readonly undo = (): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.undo', { handle: this.handle });

  readonly redo = (): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.redo', { handle: this.handle });

  readonly goTo = (node: HistoryNodeId): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.goTo', { handle: this.handle, node });

  readonly nameBranch = (
    node: HistoryNodeId,
    name: string | undefined,
  ): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.nameBranch', { handle: this.handle, node, name });

  readonly createSnapshot = (request: SnapshotRequest): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.createSnapshot', { handle: this.handle, request });

  readonly deleteSnapshot = (snapshot: SnapshotId): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.deleteSnapshot', { handle: this.handle, snapshot });

  /** Records an export's provenance, which the worker gives an identifier and a time. */
  readonly recordExport = (draft: ExportDraft): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.recordExport', { handle: this.handle, draft });

  readonly compare = (
    a: ComparisonSource,
    b: ComparisonSource,
  ): Promise<DomainResult<ComparisonOutcome>> =>
    this.#channel.call('projects.compare', { handle: this.handle, a, b });

  /** What differs between the sides of the open comparison, worked out again in the worker. */
  readonly comparedDifference = (): Promise<DomainResult<ComparedStates>> =>
    this.#channel.call('projects.comparedDifference', { handle: this.handle });

  /** The project as it stands at side `side` of the open comparison, worked out in the worker. */
  readonly comparedState = (side: SideName): Promise<DomainResult<ProjectState>> =>
    this.#channel.call('projects.comparedState', { handle: this.handle, side });

  readonly switchSide = (side?: SideName): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.switchSide', { handle: this.handle, side });

  readonly closeComparison = (): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.closeComparison', { handle: this.handle });

  readonly promote = (side: SideName): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.promote', { handle: this.handle, side });

  readonly planCompaction = (request: CompactionRequest): Promise<DomainResult<CompactionPlan>> =>
    this.#channel.call('projects.planCompaction', { handle: this.handle, request });

  readonly compactHistory = (
    plan: CompactionPlan,
    confirmation: CompactionConfirmation,
  ): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.compactHistory', { handle: this.handle, plan, confirmation });

  readonly setRetentionPolicy = (
    policy: RetentionPolicy,
    confirmation?: CompactionConfirmation,
  ): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.setRetentionPolicy', {
      handle: this.handle,
      policy,
      confirmation,
    });

  readonly setBackupPolicy = (policy: BackupPolicy): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.setBackupPolicy', { handle: this.handle, policy });

  readonly checkpoint = (): Promise<DomainResult<WriteOutcome>> =>
    this.#channel.call('projects.checkpoint', { handle: this.handle });

  readonly retry = (): Promise<SaveStatus> =>
    this.#channel.call('projects.retry', { handle: this.handle });

  readonly answerTransfer = (
    request: TransferRequest,
    answer: TransferAnswer,
  ): Promise<DomainResult<void>> =>
    this.#channel.call('projects.answerTransfer', { handle: this.handle, request, answer });

  /**
   * Checkpoints and closes the project, letting the lease go, and stops hearing
   * it. Refused, and the project kept open, while anything is not saved.
   */
  readonly close = async (): Promise<DomainResult<void>> => {
    const closed = await this.#channel.call('projects.close', { handle: this.handle });
    if (closed.ok) this.#stopHearing();
    return closed;
  };
}

/** A project open to read in the worker (see the module comment). */
export class RemoteReadOnlyProject {
  readonly project: ProjectId;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ProjectSnapshot;
  readonly #channel: ClientChannel;
  readonly #handle: ProjectHandle;
  readonly #stopHearing: () => void;

  constructor(parts: RemoteParts) {
    this.project = parts.mirror.getSnapshot().project;
    this.subscribe = parts.mirror.subscribe;
    this.getSnapshot = parts.mirror.getSnapshot;
    this.#channel = parts.channel;
    this.#handle = parts.handle;
    this.#stopHearing = parts.stopHearing;
  }

  /**
   * Asks the window writing the project to hand it over, settling with its
   * answer, or `unreachable` where it has not answered by the time `signal`
   * aborts.
   */
  readonly requestTransfer = async (
    signal?: AbortSignal,
  ): Promise<DomainResult<TransferOutcome>> => {
    try {
      return await this.#channel.call(
        'projects.requestTransfer',
        { handle: this.#handle },
        { signal },
      );
    } catch (error) {
      // The signal abandons the call, which tells the worker to stop asking:
      // the view's own answer to that, and not a failure.
      if (signal?.aborted === true && error === signal.reason) return succeed('unreachable');
      throw error;
    }
  };

  /**
   * Stops hearing the project and closes it in the worker, which stops
   * watching it. Settles once the worker has.
   */
  readonly close = async (): Promise<void> => {
    this.#stopHearing();
    await this.#channel.call('projects.closeView', { handle: this.#handle });
  };
}
