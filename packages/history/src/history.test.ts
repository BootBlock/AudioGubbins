import { describe, expect, it } from 'vitest';

import { commandId } from '@audiogubbins/commands';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { LONGEST_CHANGE_DESCRIPTION, historyLabelFrom } from '@audiogubbins/project-format';

import {
  changeNodeOf,
  nameBranch,
  recordChange,
  withStateFingerprint,
  type History,
} from './history.js';
import { activeLine, alternativeBranches } from './lines.js';
import {
  EPOCH,
  NOTHING_AFFECTED,
  fingerprintOf,
  grown,
  invocation,
  movedTo,
  newHistory,
  testIds,
} from './testing/histories.js';

describe('a branching history', () => {
  it('keeps B → C when the person goes back to A and makes D (REQ-STOR-193)', () => {
    const ids = testIds();
    const start = newHistory(ids);
    const [a, b, c, d] = [0, 1, 2, 3].map(() => ids.next<'HistoryNodeId'>());
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error();

    let history = grown(start, a, 'A');
    history = grown(history, b, 'B');
    history = grown(history, c, 'C');
    history = movedTo(history, a);
    history = grown(history, d, 'D');

    expect([...history.nodes.keys()].sort()).toEqual([start.root, a, b, c, d].sort());
    expect(history.cursor).toBe(d);
    expect(history.children.get(a)).toEqual([b, d]);
    expect(activeLine(history).map((node) => node.id)).toEqual([start.root, a, d]);
    expect(alternativeBranches(history)).toEqual([
      { forkPoint: a, first: b, changes: 2, latestAt: EPOCH + 3 },
    ]);
  });

  it('leaves every earlier history value as it was', () => {
    const ids = testIds();
    const before = newHistory(ids);
    const after = grown(before, ids.next<'HistoryNodeId'>(), 'A');
    expect(before.nodes.size).toBe(1);
    expect(before.cursor).toBe(before.root);
    expect(after.nodes.size).toBe(2);
  });

  it('makes a change node a child of the cursor from the command layer’s entry', () => {
    const ids = testIds();
    const history = newHistory(ids);
    const id = ids.next<'HistoryNodeId'>();
    const node = changeNodeOf(history, {
      id,
      at: EPOCH + 5,
      entry: {
        description: 'Delete 3 regions',
        forward: [invocation('delete', 'x')],
        inverse: [invocation('restore', 'x')],
      },
      affects: NOTHING_AFFECTED,
      stateFingerprint: fingerprintOf(9),
    });
    expect(node).toEqual({
      kind: 'change',
      id,
      parent: history.root,
      at: EPOCH + 5,
      description: 'Delete 3 regions',
      forward: [invocation('delete', 'x')],
      inverse: [invocation('restore', 'x')],
      affects: NOTHING_AFFECTED,
      stateFingerprint: fingerprintOf(9),
    });
  });

  it('shortens a description past the format’s longest, never splitting a surrogate pair', () => {
    const ids = testIds();
    const history = newHistory(ids);
    const long = `${'a'.repeat(LONGEST_CHANGE_DESCRIPTION - 2)}😀😀`;
    const node = changeNodeOf(history, {
      id: ids.next<'HistoryNodeId'>(),
      at: EPOCH,
      entry: {
        description: long,
        forward: [invocation('a', 'b')],
        inverse: [invocation('a', 'c')],
      },
      affects: NOTHING_AFFECTED,
    });
    expect(node.description.length).toBeLessThanOrEqual(LONGEST_CHANGE_DESCRIPTION);
    expect(node.description.endsWith('…')).toBe(true);
    expect(node.description).toBe(`${'a'.repeat(LONGEST_CHANGE_DESCRIPTION - 2)}…`);
    expect(expectSuccess(recordChange(history, node)).cursor).toBe(node.id);
  });

  it('refuses a change that is not a child of the cursor', () => {
    const ids = testIds();
    const history = grown(newHistory(ids), ids.next<'HistoryNodeId'>(), 'A');
    const stale = changeNodeOf(newHistory(testIds(99)), {
      id: ids.next<'HistoryNodeId'>(),
      at: EPOCH,
      entry: { description: 'X', forward: [invocation('a', 'b')], inverse: [invocation('a', 'c')] },
      affects: NOTHING_AFFECTED,
    });
    expect(expectFailureCode(recordChange(history, stale))).toBe('history.not-at-cursor');
  });

  it('refuses a node identifier the history holds', () => {
    const ids = testIds();
    const id = ids.next<'HistoryNodeId'>();
    let history = grown(newHistory(ids), id, 'A');
    history = movedTo(history, history.root);
    const again = changeNodeOf(history, {
      id,
      at: EPOCH,
      entry: { description: 'A', forward: [invocation('a', 'b')], inverse: [invocation('a', 'c')] },
      affects: NOTHING_AFFECTED,
    });
    expect(expectFailureCode(recordChange(history, again))).toBe('history.duplicate-node');
  });

  it('refuses a change its project could not read back, and holds nothing of it', () => {
    const ids = testIds();
    const history = newHistory(ids);
    const node = changeNodeOf(history, {
      id: ids.next<'HistoryNodeId'>(),
      at: EPOCH,
      entry: {
        description: 'Too much',
        forward: [{ commandId: commandId('test.do'), arguments: { level: Number.NaN } }],
        inverse: [invocation('undo', 'x')],
      },
      affects: NOTHING_AFFECTED,
    });
    const result = recordChange(history, node);
    expect(expectFailureCode(result)).toBe('history.unrecordable-change');
    expect(result.ok ? undefined : result.failures[0].cause?.code).toBe('schema.unknown-value');
    expect(history.nodes.size).toBe(1);
  });
});

describe('a node’s state fingerprint', () => {
  function withChange(): History {
    const ids = testIds();
    return grown(newHistory(ids), ids.next<'HistoryNodeId'>(), 'A');
  }

  it('is recorded once computed, and recording the same again changes nothing', () => {
    const history = withChange();
    const fingerprinted = expectSuccess(
      withStateFingerprint(history, history.cursor, fingerprintOf(1)),
    );
    expect(fingerprinted.nodes.get(history.cursor)?.stateFingerprint).toBe(fingerprintOf(1));
    expect(history.nodes.get(history.cursor)?.stateFingerprint).toBeUndefined();
    expect(
      expectSuccess(withStateFingerprint(fingerprinted, history.cursor, fingerprintOf(1))),
    ).toBe(fingerprinted);
  });

  it('is refused where the node holds another, or is not in the history', () => {
    const history = withChange();
    const fingerprinted = expectSuccess(
      withStateFingerprint(history, history.cursor, fingerprintOf(1)),
    );
    expect(
      expectFailureCode(withStateFingerprint(fingerprinted, history.cursor, fingerprintOf(2))),
    ).toBe('history.fingerprint-differs');
    expect(
      expectFailureCode(
        withStateFingerprint(history, testIds(3).next<'HistoryNodeId'>(), fingerprintOf(2)),
      ),
    ).toBe('history.unknown-node');
  });
});

describe('branch names', () => {
  it('are set on a node, may repeat, and are removed by naming nothing', () => {
    const ids = testIds();
    const history = grown(newHistory(ids), ids.next<'HistoryNodeId'>(), 'A');
    const name = expectSuccess(historyLabelFrom('  Brighter mix  '));
    const named = expectSuccess(nameBranch(history, history.cursor, name));
    const twice = expectSuccess(nameBranch(named, named.root, name));
    expect(twice.branchNames.get(history.cursor)).toBe('Brighter mix');
    expect(twice.branchNames.get(history.root)).toBe('Brighter mix');
    expect(expectSuccess(nameBranch(twice, history.cursor, undefined)).branchNames.size).toBe(1);
    expect(history.branchNames.size).toBe(0);
  });

  it('are refused on a node the history does not hold', () => {
    const history = newHistory(testIds());
    const name = expectSuccess(historyLabelFrom('X'));
    expect(expectFailureCode(nameBranch(history, testIds(5).next<'HistoryNodeId'>(), name))).toBe(
      'history.unknown-node',
    );
  });
});
