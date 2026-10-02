import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import { withStateFingerprint, type History } from './history.js';
import { activeLine } from './lines.js';
import {
  moveTo,
  pathBetween,
  redo,
  redoTarget,
  restorationOf,
  undo,
  undoTarget,
  type Navigation,
} from './navigation.js';
import {
  fingerprintOf,
  grown,
  invocation,
  movedTo,
  newHistory,
  readCounted,
  testIds,
} from './testing/histories.js';

/** A B C on one line, then D from A: the tree of REQ-STOR-193's example. */
function example(): { history: History; ids: Record<'o' | 'a' | 'b' | 'c' | 'd', HistoryNodeId> } {
  const generator = testIds();
  const start = newHistory(generator);
  const a = generator.next<'HistoryNodeId'>();
  const b = generator.next<'HistoryNodeId'>();
  const c = generator.next<'HistoryNodeId'>();
  const d = generator.next<'HistoryNodeId'>();
  let history = grown(grown(grown(start, a, 'A'), b, 'B'), c, 'C');
  history = grown(movedTo(history, a), d, 'D');
  return { history, ids: { o: start.root, a, b, c, d } };
}

function descriptions(nodes: readonly { readonly description: string }[]): readonly string[] {
  return nodes.map((node) => node.description);
}

function expectMove(navigation: Navigation | undefined): Navigation {
  if (navigation === undefined) throw new Error('Expected a move.');
  return navigation;
}

describe('the path between two nodes', () => {
  it('reverses up to the common ancestor, newest first, and replays down, oldest first', () => {
    const { history, ids } = example();
    const path = expectSuccess(pathBetween(history, ids.c, ids.d));
    expect(descriptions(path.undo)).toEqual(['C', 'B']);
    expect(descriptions(path.redo)).toEqual(['D']);
    expect(expectSuccess(pathBetween(history, ids.o, ids.c)).undo).toEqual([]);
    expect(descriptions(expectSuccess(pathBetween(history, ids.o, ids.c)).redo)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(expectSuccess(pathBetween(history, ids.b, ids.b))).toEqual({ undo: [], redo: [] });
  });

  it('is refused for a node the history does not hold', () => {
    const { history, ids } = example();
    const stranger = testIds(55).next<'HistoryNodeId'>();
    expect(expectFailureCode(pathBetween(history, stranger, ids.a))).toBe('history.unknown-node');
    expect(expectFailureCode(pathBetween(history, ids.a, stranger))).toBe('history.unknown-node');
  });

  it('is found between the tips of two branches ten thousand changes deep without recursion', () => {
    const generator = testIds(3);
    let history = newHistory(generator);
    for (let step = 0; step < 5_000; step += 1) {
      history = grown(history, generator.next<'HistoryNodeId'>(), `Trunk ${String(step)}`);
    }
    const fork = history.cursor;
    for (let step = 0; step < 5_000; step += 1) {
      history = grown(history, generator.next<'HistoryNodeId'>(), `Left ${String(step)}`);
    }
    const left = history.cursor;
    history = movedTo(history, fork);
    for (let step = 0; step < 5_000; step += 1) {
      history = grown(history, generator.next<'HistoryNodeId'>(), `Right ${String(step)}`);
    }
    const right = history.cursor;

    const path = expectSuccess(pathBetween(history, left, right));
    expect(path.undo).toHaveLength(5_000);
    expect(path.redo).toHaveLength(5_000);
    expect(path.undo[0]?.description).toBe('Left 4999');
    expect(path.redo[0]?.description).toBe('Right 0');
    expect(expectSuccess(pathBetween(history, history.root, right)).redo).toHaveLength(10_000);
  });
});

/** A line of `depth` changes from a new project's origin, its cursor at the newest. */
function lineOf(depth: number): History {
  const generator = testIds(5);
  let history = newHistory(generator);
  for (let step = 0; step < depth; step += 1) {
    history = grown(history, generator.next<'HistoryNodeId'>(), `Step ${String(step)}`);
  }
  return history;
}

/** How many nodes planning one undo and one redo reads, at the end of a line `depth` deep. */
function nodesReadForOneStep(depth: number): number {
  const deep = lineOf(depth);
  const { history, reads } = readCounted(deep);
  const undone = expectMove(undo(history));
  const counted = readCounted(undone.history);
  expectMove(redo(counted.history));
  return reads() + counted.reads();
}

describe('one step of undo or redo', () => {
  it('reads as many nodes ten thousand changes deep as ten changes deep', () => {
    expect(nodesReadForOneStep(10_000)).toBe(nodesReadForOneStep(10));
  });

  it('plans the path between two nodes a few steps apart by those steps alone', () => {
    const deep = lineOf(10_000);
    const above = [...activeLine(deep)].at(-4)?.id;
    if (above === undefined) throw new Error('No node three steps up.');
    const { history, reads } = readCounted(deep);
    expect(expectSuccess(pathBetween(history, history.cursor, above)).undo).toHaveLength(3);
    expect(reads()).toBeLessThan(20);
  });
});

describe('undo and redo', () => {
  it('undo reverses the cursor’s change, and redo replays it', () => {
    const { history, ids } = example();
    expect(undoTarget(history)?.id).toBe(ids.d);
    const undone = expectMove(undo(history));
    expect(undone.history.cursor).toBe(ids.a);
    expect(undone.invocations).toEqual([invocation('undo', 'D')]);
    expect(redoTarget(undone.history)?.id).toBe(ids.d);
    const redone = expectMove(redo(undone.history));
    expect(redone.history.cursor).toBe(ids.d);
    expect(redone.invocations).toEqual([invocation('do', 'D')]);
  });

  it('redo follows the branch visited most recently, not the newest', () => {
    const { history, ids } = example();
    const onB = movedTo(history, ids.b);
    const back = expectMove(undo(expectMove(undo(onB)).history)).history;
    expect(back.cursor).toBe(ids.o);
    expect(expectMove(redo(back)).history.cursor).toBe(ids.a);
    const atA = movedTo(back, ids.a);
    expect(redoTarget(atA)?.id).toBe(ids.b);
    expect(activeLine(atA).map((node) => node.id)).toEqual([ids.o, ids.a, ids.b, ids.c]);
  });

  it('can undo to the root and no further, and redo to the tip and no further', () => {
    const { history, ids } = example();
    let current = history;
    for (let move = undo(current); move !== undefined; move = undo(current)) current = move.history;
    expect(current.cursor).toBe(ids.o);
    expect(undoTarget(current)).toBeUndefined();
    for (let move = redo(current); move !== undefined; move = redo(current)) current = move.history;
    expect(current.cursor).toBe(ids.d);
    expect(redoTarget(current)).toBeUndefined();
  });

  it('never removes a node, whatever the moves', () => {
    const { history, ids } = example();
    const moved = movedTo(movedTo(movedTo(history, ids.c), ids.o), ids.d);
    expect(moved.nodes.size).toBe(history.nodes.size);
    expect(moved.nodes).toBe(history.nodes);
  });
});

describe('moving to any node', () => {
  it('plans the invocations in order and leaves the history it started from alone', () => {
    const { history, ids } = example();
    const move = expectSuccess(moveTo(history, ids.c));
    expect(move.invocations).toEqual([
      invocation('undo', 'D'),
      invocation('do', 'B'),
      invocation('do', 'C'),
    ]);
    expect(move.history.cursor).toBe(ids.c);
    expect(history.cursor).toBe(ids.d);
  });

  it('is refused for a node the history does not hold', () => {
    const { history } = example();
    expect(expectFailureCode(moveTo(history, testIds(55).next<'HistoryNodeId'>()))).toBe(
      'history.unknown-node',
    );
  });
});

describe('restoration from a kept state', () => {
  it('replays from the nearest kept state at or above the target', () => {
    const { history, ids } = example();
    const kept = expectSuccess(withStateFingerprint(history, ids.a, fingerprintOf(1)));
    const restoration = expectSuccess(
      restorationOf(kept, ids.c, (state) => state === fingerprintOf(1)),
    );
    expect(restoration.base.id).toBe(ids.a);
    expect(restoration.baseState).toBe(fingerprintOf(1));
    expect(descriptions(restoration.redo)).toEqual(['B', 'C']);
    expect(restoration.history.cursor).toBe(ids.c);
  });

  it('passes over a fingerprint whose state is not kept', () => {
    const { history, ids } = example();
    const withTwo = expectSuccess(
      withStateFingerprint(
        expectSuccess(withStateFingerprint(history, ids.o, fingerprintOf(1))),
        ids.b,
        fingerprintOf(2),
      ),
    );
    const restoration = expectSuccess(
      restorationOf(withTwo, ids.c, (state) => state === fingerprintOf(1)),
    );
    expect(restoration.base.id).toBe(ids.o);
    expect(descriptions(restoration.redo)).toEqual(['A', 'B', 'C']);
  });

  it('is refused where no state at or above the target is kept', () => {
    const { history, ids } = example();
    expect(expectFailureCode(restorationOf(history, ids.c, () => true))).toBe(
      'history.no-kept-state',
    );
  });
});
