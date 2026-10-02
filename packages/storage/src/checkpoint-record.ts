/**
 * What a checkpoint holds: a project's whole history and everything kept beside
 * it, as of one position in its journal (ADR-0020, REQ-STOR-101).
 *
 * A checkpoint names the state at the history's cursor and every state the
 * history keeps whole: the root, each named snapshot's, and those kept along
 * the way so a move need not replay from far off. It also holds the export log,
 * the retention and backup policies, the open comparison, and the epoch of the
 * lease it was written under. States are kept in their own files, and the
 * history's nodes in segments of their own (`segment-ledger.ts`), so a
 * checkpoint stays small however large its project and however long its
 * history. Its record is read first and the segments it names after, and only
 * then is the history checked whole: that the cursor's state is among those
 * kept and is the one the cursor names, and that an open comparison's sides are
 * in it.
 */

import {
  historyFromRecord,
  storedPreferences,
  type Comparison,
  type History,
} from '@audiogubbins/history';
import {
  historyFromSegments,
  listConverter,
  objectOf,
  optional,
  pathOf,
  presentMembers,
  readBackupPolicy,
  readComparisonChoice,
  readExportRecord,
  readRetentionPolicy,
  readSegmentedHistory,
  required,
  sortedBy,
  writeBackupPolicy,
  writeComparisonChoice,
  writeExportRecord,
  writeRetentionPolicy,
  writeSegmentedHistory,
  type BackupPolicy,
  type ComparisonChoiceRecord,
  type Converter,
  type ExportRecord,
  type HistoryNodeId,
  type HistorySegmentRecord,
  type HistorySegmentReference,
  type JsonObject,
  type Reading,
  type RetentionPolicy,
  type SegmentedHistoryRecord,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import { choiceOf, comparisonFrom } from './comparison-record.js';
import { asFingerprint, asWholeNumber } from './record-values.js';

/** A project as of a position in its journal. */
export interface Checkpoint {
  readonly history: History;

  /** The state at the history's cursor. */
  readonly cursorState: StateFingerprint;

  /** Every state the checkpoint keeps whole, the cursor's among them. */
  readonly keptStates: ReadonlySet<StateFingerprint>;
  readonly exports: readonly ExportRecord[];
  readonly retention: RetentionPolicy;
  readonly backup: BackupPolicy;
  readonly comparison?: Comparison;

  /** The epoch of the write lease the checkpoint was written under. */
  readonly leaseEpoch: number;
}

/**
 * A checkpoint as its record holds it: the history without its nodes, which the
 * segments it names hold, and the comparison as the choice it was.
 */
export interface CheckpointRecord extends Omit<Checkpoint, 'history' | 'comparison'> {
  readonly history: SegmentedHistoryRecord;
  readonly comparison?: ComparisonChoiceRecord;
}

/** Where a checkpoint's nodes are: the segments it names, and what they lack. */
export interface CheckpointSegments {
  readonly segments: readonly HistorySegmentReference[];

  /** The fingerprints of nodes whose segment lacks the one they have. */
  readonly fingerprints: ReadonlyMap<HistoryNodeId, StateFingerprint>;
}

const CHECKPOINT_MEMBERS: ReadonlySet<string> = new Set([
  'history',
  'cursorState',
  'keptStates',
  'exports',
  'retention',
  'backup',
  'comparison',
  'leaseEpoch',
]);

/** The most states or exports a checkpoint lists: one for each node it could hold. */
const MAXIMUM_LISTED = 10_000_000;

const asFingerprints = listConverter(MAXIMUM_LISTED, asFingerprint);
const asExportList = listConverter(MAXIMUM_LISTED, readExportRecord);

/** The export log, refusing two exports of one identifier. */
const asExports: Converter<readonly ExportRecord[]> = (reading, value, parent, key) => {
  const exports = asExportList(reading, value, parent, key);
  if (exports === undefined) return undefined;
  if (new Set(exports.map((record) => record.id)).size === exports.length) return exports;
  reading.refuse(
    'schema.duplicate-id',
    'Two exports have the same identifier.',
    pathOf(parent, key),
  );
  return undefined;
};

/** Writes a checkpoint whose nodes are in `segments`. */
export function writeCheckpoint(checkpoint: Checkpoint, segments: CheckpointSegments): JsonObject {
  const { history } = checkpoint;
  return presentMembers({
    history: writeSegmentedHistory({
      project: history.project,
      cursor: history.cursor,
      segments: segments.segments,
      fingerprints: segments.fingerprints,
      preferred: storedPreferences(history),
      branchNames: history.branchNames,
      snapshots: [...history.snapshots.values()],
    }),
    cursorState: checkpoint.cursorState,
    keptStates: sortedBy(
      checkpoint.keptStates,
      (state) => state,
      (state) => state,
    ),
    exports: checkpoint.exports.map(writeExportRecord),
    retention: writeRetentionPolicy(checkpoint.retention),
    backup: writeBackupPolicy(checkpoint.backup),
    comparison:
      checkpoint.comparison === undefined
        ? undefined
        : writeComparisonChoice(choiceOf(checkpoint.comparison)),
    leaseEpoch: checkpoint.leaseEpoch,
  });
}

/** Reads a checkpoint's record, whose history is checked once its segments are read. */
export const readCheckpointRecord: Converter<CheckpointRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CHECKPOINT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const history = required(reading, object, at, 'history', readSegmentedHistory);
  const cursorState = required(reading, object, at, 'cursorState', asFingerprint);
  const kept = required(reading, object, at, 'keptStates', asFingerprints);
  const exports = required(reading, object, at, 'exports', asExports);
  const retention = required(reading, object, at, 'retention', readRetentionPolicy);
  const backup = required(reading, object, at, 'backup', readBackupPolicy);
  const choice = optional(reading, object, at, 'comparison', readComparisonChoice);
  const leaseEpoch = required(reading, object, at, 'leaseEpoch', asWholeNumber);
  if (
    history === undefined ||
    cursorState === undefined ||
    kept === undefined ||
    exports === undefined ||
    retention === undefined ||
    backup === undefined ||
    leaseEpoch === undefined
  ) {
    return undefined;
  }
  return {
    history,
    cursorState,
    keptStates: new Set(kept),
    exports,
    retention,
    backup,
    ...(choice === undefined ? {} : { comparison: choice }),
    leaseEpoch,
  };
};

/**
 * The checkpoint a record and the segments it names, read in its order, hold,
 * or `undefined` with every problem refused. `at` is where the record was read.
 */
export function checkpointOf(
  reading: Reading,
  record: CheckpointRecord,
  segments: readonly HistorySegmentRecord[],
  at: string,
): Checkpoint | undefined {
  const historyAt = pathOf(at, 'history');
  const read = historyFromSegments(reading, record.history, segments, historyAt);
  if (read === undefined) return undefined;
  const history = historyFromRecord(read);
  if (!history.ok) {
    reading.refuseAll(history.failures, historyAt);
    return undefined;
  }
  const { cursorState, keptStates, comparison: choice, ...rest } = record;
  if (!cursorIsKept(reading, history.value, cursorState, keptStates, at)) return undefined;
  const comparison =
    choice === undefined ? undefined : comparisonIn(reading, history.value, choice, at);
  if (choice !== undefined && comparison === undefined) return undefined;
  return {
    ...rest,
    history: history.value,
    cursorState,
    keptStates,
    ...(comparison === undefined ? {} : { comparison }),
  };
}

/** Whether the cursor's state is among those kept and is the one the cursor names. */
function cursorIsKept(
  reading: Reading,
  history: History,
  cursorState: StateFingerprint,
  keptStates: ReadonlySet<StateFingerprint>,
  at: string,
): boolean {
  if (
    keptStates.has(cursorState) &&
    history.nodes.get(history.cursor)?.stateFingerprint === cursorState
  ) {
    return true;
  }
  reading.refuse(
    'checkpoint.cursor-state',
    "The checkpoint's cursor state is not the kept state its cursor names.",
    pathOf(at, 'cursorState'),
  );
  return false;
}

function comparisonIn(
  reading: Reading,
  history: History,
  choice: ComparisonChoiceRecord,
  at: string,
): Comparison | undefined {
  const comparison = comparisonFrom(history, choice);
  if (comparison.ok) return comparison.value;
  reading.refuseAll(comparison.failures, pathOf(at, 'comparison'));
  return undefined;
}
