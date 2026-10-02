import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { historyLabelFrom, type ContentId } from '@audiogubbins/project-format';

import { withStateFingerprint, type HistoryNode } from './history.js';
import { contentRetention, retainedStates } from './retention.js';
import { createSnapshot } from './snapshots.js';
import { EPOCH, fingerprintOf, grown, movedTo, newHistory, testIds } from './testing/histories.js';
import { contentOf } from './testing/states.js';

/** O → A → B and O → C, the cursor at C, a snapshot at B. */
function setUp() {
  const ids = testIds(71);
  const start = newHistory(ids);
  const [a, b, c] = [1, 2, 3].map(() => ids.next<'HistoryNodeId'>());
  if (a === undefined || b === undefined || c === undefined) throw new Error();
  let history = grown(grown(start, a, 'A'), b, 'B');
  history = expectSuccess(
    createSnapshot(history, {
      id: ids.next<'SnapshotId'>(),
      kind: 'named',
      name: expectSuccess(historyLabelFrom('Take B')),
      at: EPOCH,
      application: 'AudioGubbins 0.1.0',
      node: b,
      stateFingerprint: fingerprintOf(2),
      exports: [],
    }),
  );
  history = grown(movedTo(history, start.root), c, 'C');
  history = expectSuccess(withStateFingerprint(history, c, fingerprintOf(3)));
  return { history, node: { o: start.root, a, b, c } };
}

describe('what a history retains (REQ-STOR-193, REQ-STOR-200)', () => {
  it('names every state its nodes and snapshots hold', () => {
    const { history } = setUp();
    expect(retainedStates(history)).toEqual(new Set([fingerprintOf(2), fingerprintOf(3)]));
  });

  it('says for each piece of media whether the current state, the active line or only a branch holds it', () => {
    const { history, node } = setUp();
    const shared = contentOf('a');
    const onBranch = contentOf('b');
    const current = contentOf('c');
    const held = new Map<string, readonly ContentId[]>([
      [node.o, [shared]],
      [node.a, [shared, onBranch, onBranch]],
      [node.b, [shared, onBranch]],
      [node.c, [shared, current]],
    ]);
    const retention = contentRetention(history, (entry: HistoryNode) => held.get(entry.id) ?? []);

    expect(retention.get(current)).toEqual({
      nodes: [node.c],
      inCurrentState: true,
      onActiveLine: true,
      snapshots: [],
    });
    const branch = retention.get(onBranch);
    expect(branch?.inCurrentState).toBe(false);
    expect(branch?.onActiveLine).toBe(false);
    expect(branch?.nodes.toSorted()).toEqual([node.a, node.b].sort());
    expect(branch?.snapshots).toHaveLength(1);
    expect(retention.get(shared)?.nodes).toHaveLength(4);
    expect(retention.get(shared)?.inCurrentState).toBe(true);
  });
});
