/**
 * An open project as a value, and the one place each kind of journal event is
 * applied to it (REQ-STOR-021, REQ-STOR-101, REQ-STOR-193 to REQ-STOR-198).
 *
 * A session applies an event here as it records it, and recovery applies the
 * same event here as it replays it, so the project a reload rebuilds is made by
 * the very code that made it the first time. A change and a move need the
 * command layer to reach their state, which `history-moves.ts` does; every
 * other event is a pure function of the model and is applied here whole.
 */

import {
  FailureKind,
  fail,
  failure,
  flatMapResult,
  mapResult,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  createSnapshot,
  deleteSnapshot,
  nameBranch,
  recordChange,
  type ChangeNode,
  type Comparison,
  type History,
} from '@audiogubbins/history';
import type {
  BackupPolicy,
  ExportRecord,
  ProjectState,
  RetentionPolicy,
} from '@audiogubbins/project-format';

import { comparisonFrom } from './comparison-record.js';
import type { JournalEvent } from './journal-events.js';

/** An open project: its state, its history and what is kept beside them. */
export interface ProjectModel {
  /** The state at the history's cursor. */
  readonly state: ProjectState;
  readonly history: History;

  /** Every export's provenance, oldest first (REQ-STOR-197). */
  readonly exports: readonly ExportRecord[];
  readonly retention: RetentionPolicy;
  readonly backup: BackupPolicy;

  /** The A/B comparison open, where one is (REQ-STOR-195). */
  readonly comparison?: Comparison;
}

/** An event applied without the command layer: every kind but a change or a move. */
export type SettledEvent = Exclude<JournalEvent, { kind: 'change' } | { kind: 'move' }>;

/** The model with a change recorded at the cursor, `next` being its state after. */
export function withChange(
  model: ProjectModel,
  node: ChangeNode,
  next: ProjectState,
): DomainResult<ProjectModel> {
  return mapResult(recordChange(model.history, node), (history) => ({
    ...model,
    history,
    state: next,
  }));
}

/** The model with the cursor moved, `state` being the state at the new cursor. */
export function withMove(model: ProjectModel, history: History, state: ProjectState): ProjectModel {
  return { ...model, history, state };
}

/** The model with an event that needs no command applied. */
export function withEvent(model: ProjectModel, event: SettledEvent): DomainResult<ProjectModel> {
  switch (event.kind) {
    case 'branch-name':
      return mapResult(nameBranch(model.history, event.node, event.name), (history) => ({
        ...model,
        history,
      }));
    case 'snapshot-created':
      return mapResult(createSnapshot(model.history, event.snapshot), (history) => ({
        ...model,
        history,
      }));
    case 'snapshot-deleted':
      return flatMapResult(deleteSnapshot(model.history, event.snapshot), (history) =>
        withHistoryKeepingComparison(model, history),
      );
    case 'export':
      return withExport(model, event.record);
    case 'retention-policy':
      return succeed({ ...model, retention: event.policy });
    case 'backup-policy':
      return succeed({ ...model, backup: event.policy });
    case 'comparison':
      return withComparison(model, event);
  }
}

function withExport(model: ProjectModel, record: ExportRecord): DomainResult<ProjectModel> {
  if (model.exports.some((held) => held.id === record.id)) {
    return fail(
      failure(
        'storage.duplicate-export',
        FailureKind.Conflict,
        'The project already records this export.',
        { details: { export: record.id } },
      ),
    );
  }
  return succeed({ ...model, exports: [...model.exports, record] });
}

function withComparison(
  model: ProjectModel,
  event: Extract<SettledEvent, { kind: 'comparison' }>,
): DomainResult<ProjectModel> {
  if (event.choice === undefined) {
    const { comparison: _closed, ...rest } = model;
    return succeed(rest);
  }
  return mapResult(comparisonFrom(model.history, event.choice), (comparison) => ({
    ...model,
    comparison,
  }));
}

/**
 * The model with a history that no longer holds a snapshot. A comparison with a
 * side chosen by that snapshot is closed, since the side no longer names
 * anything the person can choose again.
 */
function withHistoryKeepingComparison(
  model: ProjectModel,
  history: History,
): DomainResult<ProjectModel> {
  const { comparison, ...rest } = model;
  const orphaned =
    comparison !== undefined &&
    [comparison.a.snapshot, comparison.b.snapshot].some(
      (snapshot) => snapshot !== undefined && !history.snapshots.has(snapshot),
    );
  return succeed(
    orphaned || comparison === undefined ? { ...rest, history } : { ...rest, history, comparison },
  );
}
