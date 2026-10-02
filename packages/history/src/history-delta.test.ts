import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { historyLabelFrom, type HistoryNodeId } from '@audiogubbins/project-format';

import { applyCompaction } from './compaction-apply.js';
import { planCompaction } from './compaction-plan.js';
import { applyHistoryDelta, historyDelta } from './history-delta.js';
import { nameBranch, type History } from './history.js';
import { createSnapshot, deleteSnapshot } from './snapshots.js';
import {
  EPOCH,
  fingerprintOf,
  grown,
  movedTo,
  newHistory,
  randomHistory,
  seededRandom,
  testIds,
} from './testing/histories.js';

/** A history as plain values in a fixed order, to compare two of them. */
function plain(history: History): unknown {
  const sorted = <T>(entries: Iterable<readonly [string, T]>) =>
    [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    project: history.project,
    root: history.root,
    cursor: history.cursor,
    nodes: sorted(history.nodes.entries()),
    children: sorted(history.children.entries()),
    preferred: sorted(history.preferred.entries()),
    branchNames: [...history.branchNames],
    snapshots: [...history.snapshots],
  };
}

/** The page's copy brought from `copy` to `later`, the delta crossing a structured clone. */
function sent(copy: History | undefined, earlier: History | undefined, later: History): History {
  return applyHistoryDelta(copy, structuredClone(historyDelta(earlier, later)));
}

describe('a history delta (ADR-0022)', () => {
  it('brings a copy from no history to the whole history across a structured clone', () => {
    const history = randomHistory(5, 300);
    expect(plain(sent(undefined, undefined, history))).toEqual(plain(history));
  });

  it('sends one change as its node and the path it changed, and keeps the rest of the copy', () => {
    const ids = testIds(41);
    const earlier = randomHistory(9, 2000);
    const copy = sent(undefined, undefined, earlier);
    const id = ids.next<'HistoryNodeId'>();
    const later = grown(earlier, id, 'One more', EPOCH + 1);

    const delta = historyDelta(earlier, later);
    expect(delta.nodes).toEqual({ set: [[id, later.nodes.get(id)]], removed: [] });
    expect(delta.children.set).toEqual([[earlier.cursor, later.children.get(earlier.cursor)]]);
    expect(delta).not.toHaveProperty('branchNames');
    expect(delta).not.toHaveProperty('snapshots');

    const updated = applyHistoryDelta(copy, structuredClone(delta));
    expect(plain(updated)).toEqual(plain(later));
    expect(updated.nodes.get(earlier.root)).toBe(copy.nodes.get(earlier.root));
    expect(updated.branchNames).toBe(copy.branchNames);
  });

  it('gives back the copy itself where nothing in the history changed', () => {
    const history = randomHistory(5, 300);
    const copy = sent(undefined, undefined, history);

    expect(sent(copy, history, history)).toBe(copy);
  });

  it('follows changes, moves, branch names and snapshots one at a time', () => {
    const random = seededRandom(17);
    const ids = testIds(17);
    let history = newHistory(ids);
    let copy = sent(undefined, undefined, history);
    const known: HistoryNodeId[] = [history.root];
    for (let step = 0; step < 400; step += 1) {
      const roll = random.next();
      const target = known[random.below(known.length)] ?? history.root;
      let next: History;
      if (roll < 0.5) {
        const id = ids.next<'HistoryNodeId'>();
        next = grown(history, id, `Step ${String(step)}`, EPOCH + step);
        known.push(id);
      } else if (roll < 0.75) {
        next = movedTo(history, target);
      } else if (roll < 0.85) {
        const name = expectSuccess(historyLabelFrom(`Branch ${String(step)}`));
        next = expectSuccess(nameBranch(history, target, name));
      } else if (roll < 0.95 || history.snapshots.size === 0) {
        // Each change node has one fingerprint, from its place in `known`.
        const place = 1 + random.below(known.length - 1);
        const node = known[place];
        if (node === undefined) continue;
        next = expectSuccess(
          createSnapshot(history, {
            id: ids.next<'SnapshotId'>(),
            kind: 'named',
            name: expectSuccess(historyLabelFrom(`Snapshot ${String(step)}`)),
            at: EPOCH + step,
            application: 'AudioGubbins 0.1.0',
            node,
            stateFingerprint: fingerprintOf(place),
            exports: [],
          }),
        );
      } else {
        const [first] = history.snapshots.keys();
        next = first === undefined ? history : expectSuccess(deleteSnapshot(history, first));
      }
      copy = sent(copy, history, next);
      history = next;
      expect(plain(copy)).toEqual(plain(history));
    }
  });

  it('removes from the copy the nodes compaction removed', () => {
    const ids = testIds(62);
    const start = newHistory(ids);
    const [a, b, c, d] = [1, 2, 3, 4].map(() => ids.next<'HistoryNodeId'>());
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error();
    let history = grown(
      grown(grown(start, a, 'A', EPOCH + 1), b, 'B', EPOCH + 2),
      c,
      'C',
      EPOCH + 3,
    );
    history = grown(movedTo(history, a), d, 'D', EPOCH + 4);
    const copy = sent(undefined, undefined, history);
    const each = { sizeOf: () => 1, now: EPOCH };
    const planned = expectSuccess(planCompaction(history, { kind: 'branches', firsts: [b] }, each));
    const compacted = expectSuccess(applyCompaction(history, planned));

    const delta = historyDelta(history, compacted);
    expect([...delta.nodes.removed].sort()).toEqual([b, c].sort());
    expect(plain(applyHistoryDelta(copy, structuredClone(delta)))).toEqual(plain(compacted));
  });

  it('refuses a delta that leaves a member unchanged when there is no history to keep it from', () => {
    const history = randomHistory(3, 20);
    const delta = historyDelta(history, grown(history, testIds(99).next(), 'More', EPOCH));
    expect(() => applyHistoryDelta(undefined, delta)).toThrow(/applied to no history/);
  });
});
