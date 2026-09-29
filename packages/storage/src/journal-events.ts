/**
 * What one journal record holds: one event of a project's history, in the form
 * it is written and read (REQ-STOR-101, REQ-STOR-193 to REQ-STOR-198).
 *
 * - `change`: a change node, with the invocations that made it and those that
 *   reverse it, recorded at the cursor.
 * - `move`: the cursor moved to a node, by undo, redo, going to a node or
 *   promoting a side of a comparison.
 * - `branch-name`: a branch named, or its name removed.
 * - `snapshot-created` and `snapshot-deleted`: a named snapshot made or
 *   deleted; the state it names is stored before the record is written.
 * - `export`: an export's provenance (REQ-STOR-197). It is not a change, and
 *   nothing undoes it (REQ-STOR-198).
 * - `retention-policy` and `backup-policy`: a policy changed.
 * - `comparison`: an A/B comparison chosen, switched or closed.
 *
 * Every event is read through the format's own readers, so a record holds
 * exactly what the project's documents hold.
 */

import { nodeFromRecord, type ChangeNode } from '@audiogubbins/history';
import {
  anyObjectOf,
  asId,
  checkMembers,
  oneOfConverter,
  optional,
  pathOf,
  presentMembers,
  readExportRecord,
  readHistoryLabel,
  readHistoryNodeRecord,
  readRetentionPolicy,
  readSnapshotRecord,
  required,
  writeExportRecord,
  writeHistoryNodeRecord,
  writeRetentionPolicy,
  writeSnapshotRecord,
  type Converter,
  type ExportRecord,
  type HistoryLabel,
  type HistoryNodeId,
  type JsonObject,
  type NamedSnapshot,
  type Reading,
  type RetentionPolicy,
  type SnapshotId,
} from '@audiogubbins/project-format';

import { readBackupPolicy, writeBackupPolicy, type BackupPolicy } from './backup-policy.js';
import { readChoice, writeChoice, type ComparisonChoice } from './comparison-record.js';

/** One event of a project's history, as a journal record holds it. */
export type JournalEvent =
  | { readonly kind: 'change'; readonly node: ChangeNode }
  | { readonly kind: 'move'; readonly to: HistoryNodeId }
  | { readonly kind: 'branch-name'; readonly node: HistoryNodeId; readonly name?: HistoryLabel }
  | { readonly kind: 'snapshot-created'; readonly snapshot: NamedSnapshot }
  | { readonly kind: 'snapshot-deleted'; readonly snapshot: SnapshotId }
  | { readonly kind: 'export'; readonly record: ExportRecord }
  | { readonly kind: 'retention-policy'; readonly policy: RetentionPolicy }
  | { readonly kind: 'backup-policy'; readonly policy: BackupPolicy }
  | { readonly kind: 'comparison'; readonly choice?: ComparisonChoice };

const EVENT_KINDS = [
  'change',
  'move',
  'branch-name',
  'snapshot-created',
  'snapshot-deleted',
  'export',
  'retention-policy',
  'backup-policy',
  'comparison',
] as const;

/** The members each kind of event is written with. */
const MEMBERS: Readonly<Record<JournalEvent['kind'], ReadonlySet<string>>> = {
  change: new Set(['kind', 'node']),
  move: new Set(['kind', 'to']),
  'branch-name': new Set(['kind', 'node', 'name']),
  'snapshot-created': new Set(['kind', 'snapshot']),
  'snapshot-deleted': new Set(['kind', 'snapshot']),
  export: new Set(['kind', 'record']),
  'retention-policy': new Set(['kind', 'policy']),
  'backup-policy': new Set(['kind', 'policy']),
  comparison: new Set(['kind', 'choice']),
};

const asEventKind = oneOfConverter(EVENT_KINDS);

/** Writes an event. */
export function writeEvent(event: JournalEvent): JsonObject {
  switch (event.kind) {
    case 'change':
      return { kind: event.kind, node: writeHistoryNodeRecord(event.node) };
    case 'move':
      return { kind: event.kind, to: event.to };
    case 'branch-name':
      return presentMembers({ kind: event.kind, node: event.node, name: event.name });
    case 'snapshot-created':
      return { kind: event.kind, snapshot: writeSnapshotRecord(event.snapshot) };
    case 'snapshot-deleted':
      return { kind: event.kind, snapshot: event.snapshot };
    case 'export':
      return { kind: event.kind, record: writeExportRecord(event.record) };
    case 'retention-policy':
      return { kind: event.kind, policy: writeRetentionPolicy(event.policy) };
    case 'backup-policy':
      return { kind: event.kind, policy: writeBackupPolicy(event.policy) };
    case 'comparison':
      return presentMembers({
        kind: event.kind,
        choice: event.choice === undefined ? undefined : writeChoice(event.choice),
      });
  }
}

/** Reads an event. */
export const readEvent: Converter<JournalEvent> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asEventKind);
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, MEMBERS[kind]);

  switch (kind) {
    case 'change': {
      const node = required(reading, object, at, 'node', asChangeNode);
      return node === undefined ? undefined : { kind, node };
    }
    case 'move': {
      const to = required(reading, object, at, 'to', asId<'HistoryNodeId'>);
      return to === undefined ? undefined : { kind, to };
    }
    case 'branch-name': {
      const node = required(reading, object, at, 'node', asId<'HistoryNodeId'>);
      const name = optional(reading, object, at, 'name', readHistoryLabel);
      return node === undefined
        ? undefined
        : { kind, node, ...(name === undefined ? {} : { name }) };
    }
    case 'snapshot-created': {
      const snapshot = required(reading, object, at, 'snapshot', readSnapshotRecord);
      return snapshot === undefined ? undefined : { kind, snapshot };
    }
    case 'snapshot-deleted': {
      const snapshot = required(reading, object, at, 'snapshot', asId<'SnapshotId'>);
      return snapshot === undefined ? undefined : { kind, snapshot };
    }
    case 'export': {
      const record = required(reading, object, at, 'record', readExportRecord);
      return record === undefined ? undefined : { kind, record };
    }
    case 'retention-policy': {
      const policy = required(reading, object, at, 'policy', readRetentionPolicy);
      return policy === undefined ? undefined : { kind, policy };
    }
    case 'backup-policy': {
      const policy = required(reading, object, at, 'policy', readBackupPolicy);
      return policy === undefined ? undefined : { kind, policy };
    }
    case 'comparison': {
      const choice = optional(reading, object, at, 'choice', readChoice);
      // A choice present but refused has been recorded as a problem, so the
      // reading fails whatever is returned here.
      return { kind, ...(choice === undefined ? {} : { choice }) };
    }
  }
};

/**
 * Reads a change node, refusing an origin or a change with no parent, which the
 * journal never records, and any invocation the command layer would not accept
 * as one.
 */
const asChangeNode: Converter<ChangeNode> = (reading: Reading, value, parent, key) => {
  const record = readHistoryNodeRecord(reading, value, parent, key);
  if (record === undefined) return undefined;
  if (record.kind !== 'change' || record.parent === undefined) {
    reading.refuse(
      'journal.not-a-change',
      'A journal records a change made at a node, never an origin.',
      pathOf(parent, key),
    );
    return undefined;
  }
  const node = nodeFromRecord(record);
  if (!node.ok) {
    reading.refuseAll(node.failures, pathOf(parent, key));
    return undefined;
  }
  return node.value.kind === 'change' ? node.value : undefined;
};
