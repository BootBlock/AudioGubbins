/**
 * Named snapshots in a history: making one, deleting one, and finding those at
 * each node (REQ-STOR-194).
 *
 * A snapshot is an explicit restore point at a node, made independently of undo
 * and redo. It is immutable: nothing here edits one, and only an explicit
 * deletion removes one. Its node is kept by every compaction, so the state it
 * names can always be restored (REQ-STOR-055).
 */

import {
  FailureKind,
  fail,
  failure,
  flatMapResult,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  compareCodeUnits,
  readSnapshotRecord,
  startReading,
  writeSnapshotRecord,
  type HistoryNodeId,
  type NamedSnapshot,
  type SnapshotId,
} from '@audiogubbins/project-format';

import { unknownNode, withStateFingerprint, type History } from './history.js';

/**
 * The history with a snapshot added. Refused where its identifier is taken, its
 * node is not in the history, its fingerprint differs from the one its node
 * holds, or the format could not read it back. A node that had no fingerprint
 * takes the snapshot's.
 */
export function createSnapshot(history: History, snapshot: NamedSnapshot): DomainResult<History> {
  if (history.snapshots.has(snapshot.id)) {
    return fail(
      failure(
        'history.duplicate-snapshot',
        FailureKind.Conflict,
        'The history holds this snapshot.',
        {
          details: { snapshot: snapshot.id },
        },
      ),
    );
  }
  if (!history.nodes.has(snapshot.node)) return fail(unknownNode(snapshot.node));

  const reading = startReading();
  const read = reading.outcome(
    readSnapshotRecord(reading, writeSnapshotRecord(snapshot), '', 'snapshot'),
  );
  if (!read.ok) return read;

  return flatMapResult(
    withStateFingerprint(history, snapshot.node, snapshot.stateFingerprint),
    (fingerprinted) =>
      succeed({
        ...fingerprinted,
        snapshots: new Map(fingerprinted.snapshots).set(snapshot.id, snapshot),
      }),
  );
}

/** The refusal of a snapshot the history does not hold. */
export function unknownSnapshot(snapshot: SnapshotId): DomainFailure {
  return failure(
    'history.unknown-snapshot',
    FailureKind.Rejected,
    'The history holds no such snapshot.',
    { details: { snapshot } },
  );
}

/** The history without a snapshot, which the person has chosen to delete. */
export function deleteSnapshot(history: History, id: SnapshotId): DomainResult<History> {
  if (!history.snapshots.has(id)) return fail(unknownSnapshot(id));
  const snapshots = new Map(history.snapshots);
  snapshots.delete(id);
  return succeed({ ...history, snapshots });
}

/** The snapshots at each node that has any, each node's oldest first. */
export function snapshotsByNode(
  history: History,
): ReadonlyMap<HistoryNodeId, readonly NamedSnapshot[]> {
  const byNode = new Map<HistoryNodeId, NamedSnapshot[]>();
  const ordered = [...history.snapshots.values()].sort(
    (left, right) => left.at - right.at || compareCodeUnits(left.id, right.id),
  );
  for (const snapshot of ordered) {
    const held = byNode.get(snapshot.node);
    if (held === undefined) byNode.set(snapshot.node, [snapshot]);
    else held.push(snapshot);
  }
  return byNode;
}
