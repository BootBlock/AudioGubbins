import { describe, expect, it } from 'vitest';

import { activeLine, ancestry, continuationOf, subtree } from './lines.js';
import { EPOCH, grown, movedTo, newHistory, testIds } from './testing/histories.js';

/** O, then A with children B (then C) and D, then E from O. */
function tree() {
  const generator = testIds(21);
  const start = newHistory(generator);
  const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(() => generator.next<'HistoryNodeId'>());
  if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
    throw new Error('Five identifiers were asked for.');
  }
  let history = grown(grown(grown(start, a, 'A', EPOCH + 1), b, 'B', EPOCH + 2), c, 'C', EPOCH + 3);
  history = grown(movedTo(history, a), d, 'D', EPOCH + 4);
  history = grown(movedTo(history, start.root), e, 'E', EPOCH + 5);
  return { history, ids: { o: start.root, a, b, c, d, e } };
}

describe('the lines through a history', () => {
  it('walks a node’s ancestry up to the root', () => {
    const { history, ids } = tree();
    expect([...ancestry(history, ids.c)].map((node) => node.id)).toEqual([
      ids.c,
      ids.b,
      ids.a,
      ids.o,
    ]);
  });

  it('walks a subtree with each parent before its children', () => {
    const { history, ids } = tree();
    const order = [...subtree(history, ids.a)].map((node) => node.id);
    expect(new Set(order)).toEqual(new Set([ids.a, ids.b, ids.c, ids.d]));
    expect(order.indexOf(ids.b)).toBeLessThan(order.indexOf(ids.c));
    expect(order[0]).toBe(ids.a);
  });

  it('continues through the child visited most recently', () => {
    const { history, ids } = tree();
    expect(continuationOf(history, ids.o)).toBe(ids.e);
    expect(continuationOf(history, ids.a)).toBe(ids.d);
    expect(continuationOf(history, ids.e)).toBeUndefined();
  });

  it('runs the active line from the root through the cursor to the tip redo reaches', () => {
    const { history, ids } = tree();
    expect(activeLine(history).map((node) => node.id)).toEqual([ids.o, ids.e]);
    const atA = movedTo(history, ids.a);
    expect(activeLine(atA).map((node) => node.id)).toEqual([ids.o, ids.a, ids.d]);
  });
});
