import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { historyLabelFrom, type HistoryNodeId } from '@audiogubbins/project-format';

import { nameBranch, parentOf, type History } from './history.js';
import { historyRowOrder, type HistoryRowOrder } from './history-row-order.js';
import { continuationOf } from './lines.js';
import { grown, movedTo, newHistory, seededRandom, testIds } from './testing/histories.js';

/** Every row of an order, its node and depth, and what it says of the whole. */
function listed(order: HistoryRowOrder) {
  return {
    rows: Array.from({ length: order.count }, (_, index) => [
      order.nodeAt(index),
      order.depthAt(index),
    ]),
    changes: order.changes,
    branches: order.branches,
  };
}

/** The history with `nodes` read through a count of the nodes read. */
function counted(history: History): { readonly history: History; readonly reads: () => number } {
  let reads = 0;
  const nodes = new Proxy(history.nodes, {
    get(target, key, receiver) {
      const member: unknown = Reflect.get(target, key, receiver);
      if (key !== 'get' || typeof member !== 'function') return member;
      return (id: HistoryNodeId) => {
        reads += 1;
        return target.get(id);
      };
    },
  });
  return { history: { ...history, nodes }, reads: () => reads };
}

/** A linear history of `size` changes. */
function linear(size: number): History {
  const ids = testIds(61);
  let history = newHistory(ids);
  for (let step = 0; step < size; step += 1) {
    history = grown(history, ids.next<'HistoryNodeId'>(), `Step ${String(step)}`);
  }
  return history;
}

describe('the order of the History panel’s rows (REQ-STOR-196)', () => {
  it('carried from one history to the next, lists each as an order worked out afresh does', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const random = seededRandom(seed);
      const ids = testIds(seed + 100);
      let history = newHistory(ids);
      const known: HistoryNodeId[] = [history.root];
      let order = historyRowOrder(history);
      for (let step = 0; step < 120; step += 1) {
        const roll = random.next();
        const node = history.nodes.get(history.cursor);
        const parent = node === undefined ? undefined : parentOf(node);
        const onward = continuationOf(history, history.cursor);
        if (roll < 0.15 && parent !== undefined) history = movedTo(history, parent);
        else if (roll < 0.25 && onward !== undefined) history = movedTo(history, onward);
        else if (roll < 0.32) {
          history = movedTo(history, known[random.below(known.length)] ?? history.root);
        } else if (roll < 0.36) {
          const name = expectSuccess(historyLabelFrom(`Branch ${String(step)}`));
          history = expectSuccess(nameBranch(history, history.cursor, name));
        } else {
          const id = ids.next<'HistoryNodeId'>();
          history = grown(history, id, `Step ${String(step)}`);
          known.push(id);
        }
        // Now and then the order is carried over several changes at once.
        if (random.next() < 0.3) continue;
        order = historyRowOrder(history, order);
        expect(listed(order), `seed ${String(seed)}, step ${String(step)}`).toEqual(
          listed(historyRowOrder(history)),
        );
      }
    }
  });

  it('still lists the rows it listed once an order carried on from it adds rows', () => {
    const ids = testIds(62);
    const history = grown(newHistory(ids), ids.next<'HistoryNodeId'>(), 'First');
    const earlier = historyRowOrder(history);
    const before = listed(earlier);

    const later = historyRowOrder(grown(history, ids.next<'HistoryNodeId'>(), 'Second'), earlier);

    expect(later.count).toBe(3);
    expect(listed(earlier)).toEqual(before);
    expect(earlier.indexOf(later.history.cursor)).toBe(-1);
  });

  it('carries the order of a long history through a change, an undo and a redo for what they touch', () => {
    const ids = testIds(63);
    const long = linear(16_000);
    const order = historyRowOrder(long);
    const end = long.cursor;
    const node = long.nodes.get(end);
    const parent = node === undefined ? undefined : parentOf(node);
    if (parent === undefined) throw new Error('The history has no change.');

    const undone = counted(movedTo(long, parent));
    const afterUndo = historyRowOrder(undone.history, order);
    const undoReads = undone.reads();
    const redone = counted(movedTo(long, end));
    const afterRedo = historyRowOrder(redone.history, afterUndo);
    const redoReads = redone.reads();
    const changed = counted(grown(long, ids.next<'HistoryNodeId'>(), 'One more'));
    const afterChange = historyRowOrder(changed.history, afterRedo);
    const changeReads = changed.reads();

    expect(afterChange.count).toBe(16_002);
    expect(afterChange.indexOf(changed.history.cursor)).toBe(16_001);
    // Ordered afresh, each would read every node of the history.
    expect({ undoReads, redoReads, changeReads }).toEqual({
      undoReads: 0,
      redoReads: 0,
      changeReads: expect.any(Number),
    });
    expect(changeReads).toBeLessThan(10);
  });
});
