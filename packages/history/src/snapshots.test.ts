import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { historyLabelFrom, type NamedSnapshot } from '@audiogubbins/project-format';

import { withStateFingerprint, type History } from './history.js';
import { createSnapshot, deleteSnapshot, snapshotsByNode } from './snapshots.js';
import { EPOCH, fingerprintOf, grown, newHistory, testIds } from './testing/histories.js';

const ids = testIds(31);

function history(): History {
  return grown(newHistory(testIds(31)), testIds(32).next<'HistoryNodeId'>(), 'A');
}

function snapshotOf(target: History, extra: Partial<NamedSnapshot> = {}): NamedSnapshot {
  return {
    id: ids.next<'SnapshotId'>(),
    kind: 'named',
    name: expectSuccess(historyLabelFrom('Before aggressive denoise')),
    notes: 'The client liked this one.',
    at: EPOCH + 10,
    author: 'Sound designer',
    application: 'AudioGubbins 0.1.0',
    node: target.cursor,
    stateFingerprint: fingerprintOf(7),
    exports: [ids.next<'ExportRecordId'>()],
    ...extra,
  };
}

describe('named snapshots (REQ-STOR-194)', () => {
  it('are made at a node and give the node their fingerprint', () => {
    const start = history();
    const snapshot = snapshotOf(start);
    const made = expectSuccess(createSnapshot(start, snapshot));
    expect(made.snapshots.get(snapshot.id)).toBe(snapshot);
    expect(made.nodes.get(start.cursor)?.stateFingerprint).toBe(fingerprintOf(7));
    expect(start.snapshots.size).toBe(0);
  });

  it('are refused with an identifier taken, an unknown node or a fingerprint the node contradicts', () => {
    const start = history();
    const snapshot = snapshotOf(start);
    const made = expectSuccess(createSnapshot(start, snapshot));
    expect(expectFailureCode(createSnapshot(made, snapshot))).toBe('history.duplicate-snapshot');
    expect(
      expectFailureCode(
        createSnapshot(start, snapshotOf(start, { node: ids.next<'HistoryNodeId'>() })),
      ),
    ).toBe('history.unknown-node');
    const fingerprinted = expectSuccess(
      withStateFingerprint(start, start.cursor, fingerprintOf(1)),
    );
    expect(expectFailureCode(createSnapshot(fingerprinted, snapshotOf(start)))).toBe(
      'history.fingerprint-differs',
    );
  });

  it('are refused where the format could not read them back', () => {
    const start = history();
    expect(
      expectFailureCode(createSnapshot(start, snapshotOf(start, { notes: 'x'.repeat(20_000) }))),
    ).toBe('schema.text-too-long');
  });

  it('are deleted only when asked, and an unknown one is refused', () => {
    const start = history();
    const snapshot = snapshotOf(start);
    const made = expectSuccess(createSnapshot(start, snapshot));
    const deleted = expectSuccess(deleteSnapshot(made, snapshot.id));
    expect(deleted.snapshots.size).toBe(0);
    expect(made.snapshots.size).toBe(1);
    expect(expectFailureCode(deleteSnapshot(deleted, snapshot.id))).toBe(
      'history.unknown-snapshot',
    );
  });

  it('are found by node, each node’s oldest first', () => {
    const start = history();
    const later = snapshotOf(start, { at: EPOCH + 20 });
    const earlier = snapshotOf(start, { at: EPOCH + 5 });
    const made = expectSuccess(
      createSnapshot(expectSuccess(createSnapshot(start, later)), earlier),
    );
    expect(snapshotsByNode(made).get(start.cursor)).toEqual([earlier, later]);
  });
});
