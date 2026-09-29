/**
 * What a checkpoint holds: a project's whole history and everything kept beside
 * it, as of one position in its journal (ADR-0020, REQ-STOR-101).
 *
 * A checkpoint names the state at the history's cursor and every state the
 * history keeps whole: the root, each named snapshot's, and those kept along
 * the way so a move need not replay from far off. It also holds the export log,
 * the retention and backup policies, the open comparison, and the epoch of the
 * lease it was written under. States are kept in their own files, so a
 * checkpoint stays small however large its project. Reading one checks that the
 * cursor's state is among those kept and is the one the cursor names.
 */

import {
  historyFromRecord,
  historyRecordOf,
  type Comparison,
  type History,
} from '@audiogubbins/history';
import {
  listConverter,
  objectOf,
  optional,
  pathOf,
  presentMembers,
  readExportRecord,
  readHistoryRecord,
  readRetentionPolicy,
  required,
  sortedBy,
  writeExportRecord,
  writeHistoryRecord,
  writeRetentionPolicy,
  type Converter,
  type ExportRecord,
  type JsonObject,
  type Reading,
  type RetentionPolicy,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import { readBackupPolicy, writeBackupPolicy, type BackupPolicy } from './backup-policy.js';
import {
  choiceOf,
  comparisonFrom,
  readChoice,
  writeChoice,
  type ComparisonChoice,
} from './comparison-record.js';
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

/** Writes a checkpoint. */
export function writeCheckpoint(checkpoint: Checkpoint): JsonObject {
  return presentMembers({
    history: writeHistoryRecord(historyRecordOf(checkpoint.history)),
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
        : writeChoice(choiceOf(checkpoint.comparison)),
    leaseEpoch: checkpoint.leaseEpoch,
  });
}

/** Reads a checkpoint. */
export const readCheckpoint: Converter<Checkpoint> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CHECKPOINT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const history = required(reading, object, at, 'history', asHistory);
  const cursorState = required(reading, object, at, 'cursorState', asFingerprint);
  const kept = required(reading, object, at, 'keptStates', asFingerprints);
  const exports = required(reading, object, at, 'exports', asExports);
  const retention = required(reading, object, at, 'retention', readRetentionPolicy);
  const backup = required(reading, object, at, 'backup', readBackupPolicy);
  const choice = optional(reading, object, at, 'comparison', readChoice);
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
  const keptStates = new Set(kept);
  if (!cursorIsKept(reading, history, cursorState, keptStates, at)) return undefined;
  const comparison = choice === undefined ? undefined : comparisonIn(reading, history, choice, at);
  if (choice !== undefined && comparison === undefined) return undefined;
  return {
    history,
    cursorState,
    keptStates,
    exports,
    retention,
    backup,
    ...(comparison === undefined ? {} : { comparison }),
    leaseEpoch,
  };
};

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

const asHistory: Converter<History> = (reading, value, parent, key) => {
  const record = readHistoryRecord(reading, value, parent, key);
  if (record === undefined) return undefined;
  const history = historyFromRecord(record);
  if (history.ok) return history.value;
  reading.refuseAll(history.failures, pathOf(parent, key));
  return undefined;
};

function comparisonIn(
  reading: Reading,
  history: History,
  choice: ComparisonChoice,
  at: string,
): Comparison | undefined {
  const comparison = comparisonFrom(history, choice);
  if (comparison.ok) return comparison.value;
  reading.refuseAll(comparison.failures, pathOf(at, 'comparison'));
  return undefined;
}
