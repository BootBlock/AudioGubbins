import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  historyLabelFrom,
  type HistoryNodeId,
  type ProjectState,
} from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import {
  comparedDifference,
  comparisonSide,
  listenedSide,
  promotion,
  startComparison,
  switchSide,
  type Comparison,
} from './comparison.js';
import type { History } from './history.js';
import { createSnapshot } from './snapshots.js';
import { EPOCH, fingerprintOf, grown, movedTo, newHistory, testIds } from './testing/histories.js';
import { fixtureState } from './testing/states.js';

/** Two branches from the root, B and C, and a snapshot at B; the cursor at C. */
function setUp(): {
  history: History;
  b: HistoryNodeId;
  c: HistoryNodeId;
  comparison: Comparison;
} {
  const ids = testIds(41);
  const start = newHistory(ids);
  const b = ids.next<'HistoryNodeId'>();
  const c = ids.next<'HistoryNodeId'>();
  let history = grown(start, b, 'B');
  const snapshot = ids.next<'SnapshotId'>();
  history = expectSuccess(
    createSnapshot(history, {
      id: snapshot,
      kind: 'named',
      name: expectSuccess(historyLabelFrom('Loop candidate B')),
      at: EPOCH,
      application: 'AudioGubbins 0.1.0',
      node: b,
      stateFingerprint: fingerprintOf(2),
      exports: [],
    }),
  );
  history = grown(movedTo(history, start.root), c, 'C');
  const a = expectSuccess(comparisonSide(history, { kind: 'snapshot', snapshot }));
  const other = expectSuccess(comparisonSide(history, { kind: 'node', node: c }));
  return { history, b, c, comparison: expectSuccess(startComparison(a, other)) };
}

describe('whole-project A/B comparison (REQ-STOR-195)', () => {
  it('takes a side from a snapshot, with its name and fingerprint, or from a node', () => {
    const { comparison, b, c } = setUp();
    expect(comparison.a).toEqual({
      project: comparison.a.project,
      node: b,
      snapshot: comparison.a.snapshot,
      name: 'Loop candidate B',
      stateFingerprint: fingerprintOf(2),
    });
    expect(comparison.b.node).toBe(c);
    expect(comparison.listening).toBe('a');
  });

  it('switches sides as a new value, touching neither side nor the history', () => {
    const { comparison, history } = setUp();
    const nodesBefore = history.nodes;
    const switched = switchSide(comparison);
    expect(switched.listening).toBe('b');
    expect(listenedSide(switched)).toBe(comparison.b);
    expect(comparison.listening).toBe('a');
    expect(switchSide(switched)).toEqual(comparison);
    expect(switchSide(switched, 'b')).toBe(switched);
    expect(switchSide(switched, 'a').listening).toBe('a');
    expect(history.nodes).toBe(nodesBefore);
  });

  it('refuses sides of different projects, the same node, or an unknown node or snapshot', () => {
    const { comparison, history } = setUp();
    const foreign = { ...comparison.b, project: unsafeBrandId<'ProjectId'>('ffffffff-0000') };
    expect(expectFailureCode(startComparison(comparison.a, foreign))).toBe(
      'comparison.incompatible',
    );
    expect(expectFailureCode(startComparison(comparison.a, comparison.a))).toBe(
      'comparison.same-state',
    );
    const stranger = testIds(99);
    expect(
      expectFailureCode(
        comparisonSide(history, { kind: 'node', node: stranger.next<'HistoryNodeId'>() }),
      ),
    ).toBe('history.unknown-node');
    expect(
      expectFailureCode(
        comparisonSide(history, { kind: 'snapshot', snapshot: stranger.next<'SnapshotId'>() }),
      ),
    ).toBe('history.unknown-snapshot');
  });

  it('gives the difference of the two states, refusing a state of another project', () => {
    const { comparison } = setUp();
    const { state } = fixtureState(sampleProject());
    const ours: ProjectState = {
      ...state,
      project: { ...state.project, id: comparison.a.project },
    };
    const renamed: ProjectState = { ...ours, project: { ...ours.project, displayName: 'B mix' } };
    expect(expectSuccess(comparedDifference(comparison, ours, renamed)).project).toEqual([
      'displayName',
    ]);
    expect(expectFailureCode(comparedDifference(comparison, state, renamed))).toBe(
      'comparison.incompatible',
    );
  });

  it('promotes a side by moving to it, keeping the other side in the history', () => {
    const { comparison, history, b, c } = setUp();
    const promoted = expectSuccess(promotion(history, comparison, 'a'));
    expect(promoted.history.cursor).toBe(b);
    expect(promoted.history.nodes.has(c)).toBe(true);
    expect(promoted.history.nodes.size).toBe(history.nodes.size);
    const foreign: Comparison = {
      ...comparison,
      a: { ...comparison.a, project: unsafeBrandId<'ProjectId'>('ffffffff-0000') },
    };
    expect(expectFailureCode(promotion(history, foreign, 'a'))).toBe('comparison.incompatible');
  });
});
