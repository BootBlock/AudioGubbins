import { describe, expect, it } from 'vitest';

import { createDeterministicIdGenerator, type ProjectId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { stateFingerprintFrom, type StateFingerprint } from './content-identity.js';
import { startReading } from './document-reading.js';
import type { ChangeNodeRecord, HistoryNodeId, HistoryNodeRecord } from './history-record.js';
import {
  historyFromSegments,
  readHistorySegment,
  readSegmentedHistory,
  writeHistorySegment,
  writeSegmentedHistory,
  type HistorySegmentRecord,
  type SegmentedHistoryRecord,
} from './history-segments.js';

const EPOCH = 1_790_000_000_000;

function fingerprint(value: number): StateFingerprint {
  return expectSuccess(stateFingerprintFrom(`s1-${value.toString(16).padStart(64, '0')}`));
}

const ids = createDeterministicIdGenerator(31);
const PROJECT = ids.next<'ProjectId'>();
const [O, A, B, C] = [0, 1, 2, 3].map(() => ids.next<'HistoryNodeId'>()) as [
  HistoryNodeId,
  HistoryNodeId,
  HistoryNodeId,
  HistoryNodeId,
];

function change(id: HistoryNodeId, parent: HistoryNodeId, step: number): ChangeNodeRecord {
  return {
    kind: 'change',
    id,
    parent,
    at: EPOCH + step,
    description: `Step ${String(step)}`,
    forward: [{ commandId: 'project.rename', arguments: { name: `Take ${String(step)}` } }],
    inverse: [{ commandId: 'project.rename', arguments: { name: 'Before' } }],
    affects: {
      assets: [],
      tracks: [],
      buses: [],
      clips: [],
      regions: [],
      markers: [],
      effectChains: [],
      project: true,
    },
  };
}

/** O → A in the first segment, B → C in the second; C's state learned since. */
const FIRST: HistorySegmentRecord = {
  project: PROJECT,
  nodes: [{ kind: 'origin', id: O, at: EPOCH, origin: { kind: 'new' } }, change(A, O, 1)],
};
const SECOND: HistorySegmentRecord = {
  project: PROJECT,
  nodes: [{ ...change(B, A, 2), stateFingerprint: fingerprint(2) }, change(C, B, 3)],
};
const SEGMENTED: SegmentedHistoryRecord = {
  project: PROJECT,
  cursor: C,
  segments: [
    { epoch: 1, id: ids.next<'HistorySegmentId'>() },
    { epoch: 2, id: ids.next<'HistorySegmentId'>() },
  ],
  fingerprints: new Map([[C, fingerprint(3)]]),
  preferred: new Map(),
  branchNames: new Map(),
  snapshots: [],
};

/** The history the parts hold, written and read back as JSON first. */
function assembled(history: SegmentedHistoryRecord, segments: readonly HistorySegmentRecord[]) {
  const reading = startReading();
  const readHistory = reading.outcome(
    readSegmentedHistory(reading, writeSegmentedHistory(history), '', 'history'),
  );
  const readSegments = segments.map((segment) =>
    expectSuccess(
      reading.outcome(readHistorySegment(reading, writeHistorySegment(segment), '', 'segment')),
    ),
  );
  const parts = expectSuccess(readHistory);
  const outcome = startReading();
  return outcome.outcome(historyFromSegments(outcome, parts, readSegments, 'history'));
}

function nodesById(nodes: readonly HistoryNodeRecord[]): Map<HistoryNodeId, HistoryNodeRecord> {
  return new Map(nodes.map((node) => [node.id, node]));
}

describe('a history kept in segments', () => {
  it('is read back as the whole history, with the fingerprints learned since', () => {
    const history = expectSuccess(assembled(SEGMENTED, [FIRST, SECOND]));
    expect(history.cursor).toBe(C);
    const nodes = nodesById(history.nodes);
    expect([...nodes.keys()].sort()).toEqual([O, A, B, C].sort());
    expect(nodes.get(B)?.stateFingerprint).toBe(fingerprint(2));
    expect(nodes.get(C)?.stateFingerprint).toBe(fingerprint(3));
    expect(nodes.get(A)?.stateFingerprint).toBeUndefined();
  });

  it('refuses a node two segments hold', () => {
    const twice: HistorySegmentRecord = { ...SECOND, nodes: [...SECOND.nodes, change(A, O, 1)] };
    expect(expectFailureCode(assembled(SEGMENTED, [FIRST, twice]))).toBe('schema.duplicate-id');
  });

  it('refuses a segment of another project', () => {
    const foreign = { ...SECOND, project: ids.next<'ProjectId'>() satisfies ProjectId };
    expect(expectFailureCode(assembled(SEGMENTED, [FIRST, foreign]))).toBe(
      'history.foreign-segment',
    );
  });

  it('refuses a fingerprint for a node no segment holds, or one differing from its segment’s', () => {
    const stray = new Map([[ids.next<'HistoryNodeId'>(), fingerprint(9)]]);
    expect(
      expectFailureCode(assembled({ ...SEGMENTED, fingerprints: stray }, [FIRST, SECOND])),
    ).toBe('history.unknown-node');
    const differing = new Map([[B, fingerprint(9)]]);
    expect(
      expectFailureCode(assembled({ ...SEGMENTED, fingerprints: differing }, [FIRST, SECOND])),
    ).toBe('history.fingerprint-differs');
  });

  it('refuses segments that leave a node without its parent', () => {
    expect(
      expectFailureCode(assembled({ ...SEGMENTED, cursor: A, fingerprints: new Map() }, [SECOND])),
    ).toBe('history.missing-parent');
  });

  it('refuses a segment named twice', () => {
    const [first] = SEGMENTED.segments;
    if (first === undefined) throw new Error('The history names segments.');
    const reading = startReading();
    const twice = writeSegmentedHistory({ ...SEGMENTED, segments: [first, first] });
    expect(
      expectFailureCode(reading.outcome(readSegmentedHistory(reading, twice, '', 'history'))),
    ).toBe('schema.duplicate-id');
  });
});
