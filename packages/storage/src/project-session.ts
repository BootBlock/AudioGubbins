/**
 * A project open to write: the one route by which its state, its history and
 * what is kept beside them change, and are kept (REQ-STOR-021, REQ-STOR-098,
 * REQ-STOR-193 to REQ-STOR-198, REQ-EDIT-073).
 *
 * Every change runs through the command bus the caller built from the project
 * commands, is recorded as a node of the branching history with the entities it
 * affected, and is written to the journal before the operation settles. Moves
 * through the history replay invocations through the same bus, from the nearest
 * kept state where that is nearer. Snapshots, branch names, A/B comparisons,
 * export provenance and the policies are events of the journal too, so every
 * one survives a reload. An export is recorded as provenance and never as a
 * change, so nothing claims to undo what it wrote (REQ-STOR-198).
 *
 * Operations run one at a time, in the order they were asked for. Where storage
 * refuses a write, the project in memory keeps the change and the save status
 * says it is not saved and why; the next write or a retry writes everything
 * waiting, in order. Where the lease is lost, the session writes nothing more,
 * refuses every operation with the reason, and offers only to be reopened
 * read-only.
 */

import type { CommandInvocation, ExecutionResult } from '@audiogubbins/commands';
import {
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  redoTarget,
  switchSide,
  undoTarget,
  withStateFingerprint,
  type CompactionPlan,
  type CompactionRequest,
  type ComparisonSource,
  type History,
  type SideName,
} from '@audiogubbins/history';
import {
  Turns,
  historyLabelFrom,
  type BackupPolicy,
  type ExportRecord,
  type HistoryNodeId,
  type ProjectState,
  type RetentionPolicy,
  type SnapshotId,
  type StateFingerprint,
  type TreeStates,
} from '@audiogubbins/project-format';

import { choiceOf } from './comparison-record.js';
import { arriveAt, type MoveServices } from './history-moves.js';
import type { JournalEvent } from './journal-events.js';
import { keptStatesOf } from './journal-replay.js';
import {
  compactedModel,
  planHistoryCompaction,
  type CompactedModel,
  type CompactionConfirmation,
  type CompactionServices,
} from './history-compaction.js';
import { withEvent, withMove, type ProjectModel, type SettledEvent } from './project-model.js';
import { SnapshotPublisher, type ProjectSnapshot } from './project-snapshot.js';
import type {
  ChangeOutcome,
  ComparisonOutcome,
  SessionServices,
  SessionStart,
  SnapshotRequest,
} from './session-contracts.js';
import { changeMade, comparisonMade, snapshotMade } from './session-events.js';
import {
  NOTHING_TO_REDO,
  NOTHING_TO_UNDO,
  NO_COMPARISON,
  NO_SUCH_NODE,
  copyWouldOmit,
  notWritable,
  retentionUnconfirmed,
  unsavedChanges,
} from './session-failures.js';
import { isAsCheckpointed } from './project-recovery.js';
import { SessionOwnership } from './session-ownership.js';
import { SessionWriter } from './session-writer.js';
import type { TransferAnswer, TransferRequest } from './write-lease.js';
import type { SaveStatus, WriteOutcome } from './write-queue.js';

/** A project open to write (see the module comment). */
export class ProjectSession {
  readonly project: ProjectId;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ProjectSnapshot;

  private readonly services: SessionServices;
  private readonly ownership: SessionOwnership;
  private readonly keepStateEvery: number;
  private readonly writer: SessionWriter;
  private readonly publisher: SnapshotPublisher;
  private readonly moves: MoveServices;
  private readonly compacting: CompactionServices;
  private model: ProjectModel;
  private operations: Promise<unknown> = Promise.resolve();

  constructor(services: SessionServices, start: SessionStart) {
    this.project = services.files.project;
    this.services = services;
    this.keepStateEvery = start.cadence.keepStateEvery;
    this.model = start.recovered.model;
    this.writer = this.writerOf(services, start);
    this.ownership = new SessionOwnership({
      project: this.project,
      lease: start.lease,
      coordinator: services.coordinator,
      writer: this.writer,
      logger: services.logger,
      onChange: () => {
        this.publish();
      },
    });
    this.moves = {
      bus: services.bus,
      logger: services.logger,
      states: keptStatesOf(services.files, this.writer.kept, this.writer.unwritten),
    };
    this.compacting = {
      ...this.moves,
      fingerprint: async (state) => await services.files.states.fingerprint(state),
    };
    this.publisher = new SnapshotPublisher(this.snapshotNow());
    this.subscribe = this.publisher.subscribe;
    this.getSnapshot = this.publisher.getSnapshot;
  }

  /** Runs one command. */
  readonly run = async (invocation: CommandInvocation): Promise<DomainResult<ChangeOutcome>> =>
    await this.change((state) => this.services.bus.execute(state, invocation));

  /** Runs several commands as one change, which undo reverses whole. */
  readonly runGroup = async (
    description: string,
    invocations: readonly [CommandInvocation, ...CommandInvocation[]],
  ): Promise<DomainResult<ChangeOutcome>> =>
    await this.change((state) => this.services.bus.executeGroup(state, description, invocations));

  /** Reverses the change at the cursor. */
  readonly undo = async (): Promise<DomainResult<WriteOutcome>> =>
    await this.moveTowards((history) => undoTarget(history)?.parent, NOTHING_TO_UNDO);

  /** Replays the change redo follows from the cursor. */
  readonly redo = async (): Promise<DomainResult<WriteOutcome>> =>
    await this.moveTowards((history) => redoTarget(history)?.id, NOTHING_TO_REDO);

  /** Moves to any node of the history, on whichever branch it is. */
  readonly goTo = async (node: HistoryNodeId): Promise<DomainResult<WriteOutcome>> =>
    await this.moveTowards(() => node, NO_SUCH_NODE);

  /** Names the branch starting at a node, or removes its name. */
  readonly nameBranch = async (
    node: HistoryNodeId,
    name: string | undefined,
  ): Promise<DomainResult<WriteOutcome>> => {
    if (name === undefined) return await this.settle({ kind: 'branch-name', node });
    const label = historyLabelFrom(name);
    return label.ok ? await this.settle({ kind: 'branch-name', node, name: label.value }) : label;
  };

  /** Makes a named snapshot of the current state, keeping that state whole. */
  readonly createSnapshot = async (request: SnapshotRequest): Promise<DomainResult<WriteOutcome>> =>
    await this.whileWritable(async () => {
      const made = await snapshotMade(this.model, request, this.services);
      if (!made.ok) return made;
      // The state is queued before the record that names it, so storage never
      // holds a snapshot whose state it has not yet been given.
      const kept = this.writer.keep(made.value.kept.state, made.value.kept.fingerprint);
      const [written] = await Promise.all([this.commit(made.value.event, made.value.model), kept]);
      return succeed(written);
    });

  /** Deletes a snapshot the person chose to delete. */
  readonly deleteSnapshot = async (snapshot: SnapshotId): Promise<DomainResult<WriteOutcome>> =>
    await this.settle({ kind: 'snapshot-deleted', snapshot });

  /** Records an export's provenance: an event of the history, never a change. */
  readonly recordExport = async (record: ExportRecord): Promise<DomainResult<WriteOutcome>> =>
    await this.settle({ kind: 'export', record });

  /**
   * Sets how much history is kept. Where the policy would let history the
   * project holds go, it is set only with the person's confirmation of that
   * plan (`planCompaction` with the policy), and the plan is carried out with
   * it (REQ-STOR-055, REQ-STOR-106).
   */
  readonly setRetentionPolicy = async (
    policy: RetentionPolicy,
    confirmation?: CompactionConfirmation,
  ): Promise<DomainResult<WriteOutcome>> =>
    await this.whileWritable(async () => {
      const plan = await this.planned({ kind: 'policy', policy });
      if (!plan.ok) return plan;
      const event: SettledEvent = { kind: 'retention-policy', policy };
      const next = withEvent(this.model, event);
      if (!next.ok) return next;
      if (plan.value.removable.length === 0) return succeed(await this.commit(event, next.value));
      if (confirmation === undefined) return fail(retentionUnconfirmed(plan.value));
      const compacted = await compactedModel(next.value, plan.value, confirmation, this.compacting);
      if (!compacted.ok) return compacted;
      await this.commit(event, next.value);
      return succeed(await this.adoptCompaction(keeping(compacted.value)));
    });

  /**
   * Plans a compaction of the history, removing nothing: what it would free and
   * every capability it would take away, for the person to confirm.
   */
  readonly planCompaction = async (
    request: CompactionRequest,
    signal?: AbortSignal,
  ): Promise<DomainResult<CompactionPlan>> =>
    await this.exclusive(async () => await this.planned(request, signal));

  /**
   * Carries out a compaction the person confirmed, keeping the new root's state
   * whole, and writes a checkpoint of the history it leaves at once.
   */
  readonly compactHistory = async (
    plan: CompactionPlan,
    confirmation: CompactionConfirmation,
  ): Promise<DomainResult<WriteOutcome>> =>
    await this.whileWritable(async () => {
      const compacted = await compactedModel(this.model, plan, confirmation, this.compacting);
      return compacted.ok
        ? succeed(await this.adoptCompaction(keeping(compacted.value)))
        : compacted;
    });

  readonly setBackupPolicy = async (policy: BackupPolicy): Promise<DomainResult<WriteOutcome>> =>
    await this.settle({ kind: 'backup-policy', policy });

  /** Opens an A/B comparison of two states, listening to `a`, and says what differs. */
  readonly compare = async (
    a: ComparisonSource,
    b: ComparisonSource,
  ): Promise<DomainResult<ComparisonOutcome>> =>
    await this.whileWritable(async () => {
      const made = await comparisonMade(this.model, a, b, this.moves);
      if (!made.ok) return made;
      const saved = await this.commit(made.value.event, made.value.model);
      return succeed({ difference: made.value.difference, saved });
    });

  /** Listens to the named side of the open comparison, or to the other side. */
  readonly switchSide = async (side?: SideName): Promise<DomainResult<WriteOutcome>> => {
    const { comparison } = this.model;
    if (comparison === undefined) return fail(NO_COMPARISON);
    return await this.settle({
      kind: 'comparison',
      choice: choiceOf(switchSide(comparison, side)),
    });
  };

  /** Closes the open comparison. Neither state is touched. */
  readonly closeComparison = async (): Promise<DomainResult<WriteOutcome>> =>
    await this.settle({ kind: 'comparison' });

  /** Makes a side of the comparison the current state; the other stays in the history. */
  readonly promote = async (side: SideName): Promise<DomainResult<WriteOutcome>> =>
    await this.moveTowards((_, model) => model.comparison?.[side].node, NO_COMPARISON);

  /**
   * Replaces the whole project, history and all, with `model`, whose kept
   * states are `states`, and writes a checkpoint of it at once. Refused while
   * anything is not saved. The states are written into storage one at a time
   * before the checkpoint that names them, so none is held in memory waiting;
   * a crash before it leaves them named by nothing, for the next checkpoint to
   * remove. It is no change the history can undo: the caller keeps what it
   * replaces recoverable (`backup-restoring.ts`).
   */
  readonly replaceProject = async (
    model: ProjectModel,
    states: TreeStates,
    signal?: AbortSignal,
  ): Promise<DomainResult<WriteOutcome>> =>
    await this.whileWritable(async () => {
      const saved = await this.writer.checkpoint(this.model);
      if (saved.kind !== 'written') return fail(unsavedChanges(this.writer.status));
      for (const fingerprint of states.fingerprints) {
        const state = await states.load(fingerprint, signal);
        if (!state.ok) return state;
        if (state.value === undefined) continue;
        const kept = await this.services.files.states.put(state.value, signal);
        if (!kept.ok) return kept;
      }
      return succeed(await this.adoptCompaction({ model, states: new Map() }));
    });

  /** Writes a checkpoint now, as the application does when the page is hidden. */
  readonly checkpoint = async (): Promise<DomainResult<WriteOutcome>> =>
    await this.whileWritable(async () => succeed(await this.writer.checkpoint(this.model)));

  /**
   * Settles once every change made is written, so storage holds the project as
   * it is here, or fails with what is not saved.
   */
  readonly saved = async (): Promise<DomainResult<void>> => {
    const status = await this.writer.queue.settled();
    return status.kind === 'saved' ? succeed(undefined) : fail(copyWouldOmit(status));
  };

  /** Writes everything waiting after storage refused it, in order. */
  readonly retry = async (): Promise<SaveStatus> => await this.writer.queue.retry();

  /**
   * Answers another window's request for the project. Granting writes a
   * checkpoint, stops writing and lets the lease go, and is refused while
   * anything is not saved, since the other window could not see it.
   */
  readonly answerTransfer = async (
    request: TransferRequest,
    answer: TransferAnswer,
  ): Promise<DomainResult<void>> =>
    await this.whileWritable(async () => await this.ownership.answer(request, answer, this.model));

  /**
   * Checkpoints and closes the project, letting the lease go. Refused, and the
   * project kept open, while anything is not saved.
   */
  readonly close = async (): Promise<DomainResult<void>> =>
    await this.exclusive(async () =>
      this.ownership.access.kind === 'writable'
        ? await this.ownership.letGo({ kind: 'closed' }, this.model)
        : succeed(undefined),
    );

  /** The writer of everything the session writes, telling the session what it did. */
  private writerOf(services: SessionServices, start: SessionStart): SessionWriter {
    return new SessionWriter({
      files: services.files,
      ids: services.ids,
      logger: services.logger,
      yieldToHost: services.yieldToHost,
      lease: start.leaseRecord,
      position: start.recovered.position,
      checkpointed: isAsCheckpointed(start.recovered),
      keptStates: start.recovered.keptStates,
      unwritten: start.recovered.unwritten,
      segments: start.recovered.segments,
      headerName: start.headerName,
      cadence: start.cadence,
      onChange: () => {
        this.publish();
      },
      onCheckpoint: (node, state) => {
        this.nameCheckpointedState(node, state);
      },
      onCheckpointWritten: () => {
        start.lease.announceCheckpoint();
      },
      onSuperseded: () => {
        this.ownership.lose({ kind: 'taken' });
      },
    });
  }

  /** Runs a command or a group and records what it changed. */
  private async change(
    execute: (state: ProjectState) => ExecutionResult<ProjectState>,
  ): Promise<DomainResult<ChangeOutcome>> {
    return await this.whileWritable<ChangeOutcome>(async () => {
      const result = execute(this.model.state);
      if (result.kind === 'refused') return fail(...result.failures);
      if (result.kind === 'unchanged') {
        return succeed({ kind: 'unchanged', code: result.code, reason: result.reason });
      }
      const made = await changeMade(this.model, result, this.services, this.keepStateEvery);
      if (!made.ok) return made;
      const { kept } = made.value;
      if (kept !== undefined) this.writer.unwritten.set(kept.fingerprint, kept.state);
      return succeed({
        kind: 'applied',
        saved: await this.commit(made.value.event, made.value.model),
      });
    });
  }

  /** Moves the cursor to the node `targetOf` names, refused with `nowhere` where it names none. */
  private async moveTowards(
    targetOf: (history: History, model: ProjectModel) => HistoryNodeId | undefined,
    nowhere: DomainFailure,
  ): Promise<DomainResult<WriteOutcome>> {
    return await this.whileWritable(async () => {
      const { history, state } = this.model;
      const target = targetOf(history, this.model);
      if (target === undefined || !history.nodes.has(target)) return fail(nowhere);
      if (target === history.cursor) return succeed<WriteOutcome>({ kind: 'written' });
      const arrival = await arriveAt(history, state, target, this.moves);
      if (!arrival.ok) return arrival;
      const moved = withMove(this.model, arrival.value.history, arrival.value.state);
      return succeed(await this.commit({ kind: 'move', to: target }, moved));
    });
  }

  /** Applies an event that needs no command and records it. */
  private async settle(event: SettledEvent): Promise<DomainResult<WriteOutcome>> {
    return await this.whileWritable(async () => {
      const next = withEvent(this.model, event);
      return next.ok ? succeed(await this.commit(event, next.value)) : next;
    });
  }

  private async planned(
    request: CompactionRequest,
    signal?: AbortSignal,
  ): Promise<DomainResult<CompactionPlan>> {
    const { files, clock, yieldToHost } = this.services;
    const turns = new Turns(yieldToHost, signal);
    return await planHistoryCompaction(files, this.model, request, clock.now(), turns);
  }

  /**
   * Adopts a compacted or replaced project, with states it must keep. It is no
   * event of the journal: a checkpoint of it is queued at once, behind every
   * record before it and ahead of every record after, and until that checkpoint
   * is written storage holds the project as it was, which loses nothing.
   */
  private async adoptCompaction(compacted: {
    readonly model: ProjectModel;
    readonly states: ReadonlyMap<StateFingerprint, ProjectState>;
  }): Promise<WriteOutcome> {
    for (const [fingerprint, state] of compacted.states)
      this.writer.unwritten.set(fingerprint, state);
    this.model = compacted.model;
    this.publish();
    return await this.writer.checkpointReplaced(this.model);
  }

  /** Adopts the model an event made and writes the event. */
  private async commit(event: JournalEvent, next: ProjectModel): Promise<WriteOutcome> {
    this.model = next;
    this.publish();
    return await this.writer.append(event, next);
  }

  /** Runs an operation in turn, refused with the reason where this window no longer writes. */
  private async whileWritable<TValue>(
    work: () => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    return await this.exclusive(async () =>
      this.ownership.access.kind === 'writable'
        ? await work()
        : fail(notWritable(this.ownership.access)),
    );
  }

  /**
   * Runs operations one at a time, in the order asked. The chain waits on each
   * operation's settling, whatever it settled as: its outcome, a rejection
   * among them, goes to its own caller.
   */
  private async exclusive<TValue>(work: () => Promise<TValue>): Promise<TValue> {
    const result = this.operations.then(work);
    this.operations = Promise.allSettled([result]);
    return await result;
  }

  /** Adopts the fingerprint a checkpoint gave a node, in turn with the operations. */
  private nameCheckpointedState(node: HistoryNodeId, state: StateFingerprint): void {
    void this.exclusive(() => {
      const named = withStateFingerprint(this.model.history, node, state);
      if (named.ok) {
        this.model = { ...this.model, history: named.value };
      } else {
        const { code } = named.failures[0];
        this.services.logger.warning('A checkpoint named a node’s state otherwise.', { code });
      }
      return Promise.resolve();
    });
  }

  private snapshotNow(): ProjectSnapshot {
    const { project, model } = this;
    return { project, model, save: this.writer.status, access: this.ownership.access };
  }

  private publish(): void {
    this.publisher.publish(this.snapshotNow());
  }
}

/** A compaction as a model and the states it must keep: the new root's, where it moves. */
function keeping(compacted: CompactedModel) {
  const { model, rootState } = compacted;
  return {
    model,
    states: new Map(rootState === undefined ? [] : [[rootState.fingerprint, rootState.state]]),
  };
}
