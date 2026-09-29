/**
 * Writing and reading a named snapshot, and the label a branch or a snapshot is
 * named with, as JSON (REQ-STOR-194, REQ-EXEC-136.12).
 *
 * A snapshot is its own value because the journal records one when it is made,
 * and the whole history's document holds a list of them; both read it through
 * this one validation.
 */

import { unsafeBrandId } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import {
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import {
  HISTORY_LABEL,
  LONGEST_HISTORY_LABEL,
  type HistoryLabel,
  type NamedSnapshot,
  type SnapshotKind,
} from './history-record.js';
import { asId, asStateFingerprint, oneOfConverter, textConverter } from './scalar-reading.js';
import { MAXIMUM_NESTED_ITEMS, NAME_RULE, asName, asWholeQuantity } from './value-reading.js';

/** The longest notes a snapshot carries, in UTF-16 code units. */
const LONGEST_NOTES = 16_384;

const SNAPSHOT_KINDS: readonly SnapshotKind[] = ['named', 'recovery'];

const SNAPSHOT_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'kind',
  'name',
  'notes',
  'at',
  'author',
  'application',
  'node',
  'stateFingerprint',
  'exports',
]);

const asLabelText = textConverter({
  maximumLength: LONGEST_HISTORY_LABEL,
  pattern: HISTORY_LABEL,
  shape: 'a name without edge spaces or control characters',
});
const asSnapshotKind = oneOfConverter(SNAPSHOT_KINDS);
const asNotes = textConverter({ maximumLength: LONGEST_NOTES });
const asApplication = textConverter({ maximumLength: NAME_RULE.maximumLength });
const asExports = listConverter(MAXIMUM_NESTED_ITEMS, asId<'ExportRecordId'>);

/**
 * Reads the label of a branch or a snapshot, held to the rule
 * `historyLabelFrom` leaves a label in.
 */
export const readHistoryLabel: Converter<HistoryLabel> = (reading, value, parent, key) => {
  const text = asLabelText(reading, value, parent, key);
  return text === undefined ? undefined : unsafeBrandId<'HistoryLabel'>(text);
};

/** Writes a named snapshot. */
export function writeSnapshotRecord(snapshot: NamedSnapshot): JsonObject {
  return presentMembers({
    id: snapshot.id,
    kind: snapshot.kind,
    name: snapshot.name,
    notes: snapshot.notes,
    at: snapshot.at,
    author: snapshot.author,
    application: snapshot.application,
    node: snapshot.node,
    stateFingerprint: snapshot.stateFingerprint,
    exports: [...snapshot.exports],
  });
}

/** Reads a named snapshot. */
export const readSnapshotRecord: Converter<NamedSnapshot> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SNAPSHOT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const id = required(reading, object, at, 'id', asId<'SnapshotId'>);
  const kind = required(reading, object, at, 'kind', asSnapshotKind);
  const name = required(reading, object, at, 'name', readHistoryLabel);
  const notes = optional(reading, object, at, 'notes', asNotes);
  const time = required(reading, object, at, 'at', asWholeQuantity);
  const author = optional(reading, object, at, 'author', asName);
  const application = required(reading, object, at, 'application', asApplication);
  const node = required(reading, object, at, 'node', asId<'HistoryNodeId'>);
  const stateFingerprint = required(reading, object, at, 'stateFingerprint', asStateFingerprint);
  const exports = required(reading, object, at, 'exports', asExports);
  if (
    id === undefined ||
    kind === undefined ||
    name === undefined ||
    time === undefined ||
    application === undefined ||
    node === undefined ||
    stateFingerprint === undefined ||
    exports === undefined
  ) {
    return undefined;
  }
  return {
    id,
    kind,
    name,
    ...(notes === undefined ? {} : { notes }),
    at: time,
    ...(author === undefined ? {} : { author }),
    application,
    node,
    stateFingerprint,
    exports,
  };
};
