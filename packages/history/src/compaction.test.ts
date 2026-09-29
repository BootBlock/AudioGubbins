import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  ExportDestinationKind,
  ExportStatus,
  historyLabelFrom,
  readHistoryRecord,
  startReading,
  writeHistoryRecord,
  type ExportRecord,
  type HistoryNodeId,
  type RetentionPolicy,
} from '@audiogubbins/project-format';

import { applyCompaction } from './compaction-apply.js';
import { planCompaction, type CompactionContext, type CompactionPlan } from './compaction-plan.js';
import { pinnedNodes } from './compaction-shape.js';
import { historyRecordOf } from './history-conversion.js';
import { nameBranch, parentOf, type History } from './history.js';
import { activeLine } from './lines.js';
import { undoTarget } from './navigation.js';
import { createSnapshot } from './snapshots.js';
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

const DAY = 86_400_000;
const EACH_ONE_BYTE: CompactionContext = { sizeOf: () => 1, now: EPOCH };

/** O, then ten changes on one line, a minute apart; the cursor at the last. */
function line(): { history: History; nodes: readonly HistoryNodeId[] } {
  const ids = testIds(61);
  let history = newHistory(ids);
  const nodes: HistoryNodeId[] = [history.root];
  for (let step = 1; step <= 10; step += 1) {
    const id = ids.next<'HistoryNodeId'>();
    history = grown(history, id, `Step ${String(step)}`, EPOCH + step * 60_000);
    nodes.push(id);
  }
  return { history, nodes };
}

/** O → A → B → C and A → D, the cursor at D, with B → C an alternative branch named "Old". */
function branched() {
  const ids = testIds(62);
  const start = newHistory(ids);
  const [a, b, c, d] = [1, 2, 3, 4].map(() => ids.next<'HistoryNodeId'>());
  if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error();
  let history = grown(grown(grown(start, a, 'A', EPOCH + 1), b, 'B', EPOCH + 2), c, 'C', EPOCH + 3);
  history = grown(movedTo(history, a), d, 'D', EPOCH + 4);
  history = expectSuccess(nameBranch(history, b, expectSuccess(historyLabelFrom('Old'))));
  return { history, ids, node: { o: start.root, a, b, c, d } };
}

function plan(
  history: History,
  policy: RetentionPolicy,
  context: CompactionContext = EACH_ONE_BYTE,
): CompactionPlan {
  return expectSuccess(planCompaction(history, { kind: 'policy', policy }, context));
}

/** Whether a history is one tree whose stored record reads back. */
function expectSound(history: History): void {
  for (const node of history.nodes.values()) {
    const parent = parentOf(node);
    if (node.id === history.root) expect(parent).toBeUndefined();
    else expect(parent !== undefined && history.nodes.has(parent)).toBe(true);
  }
  const reading = startReading();
  const read = reading.outcome(
    readHistoryRecord(reading, writeHistoryRecord(historyRecordOf(history)), '', 'history'),
  );
  expect(read.ok).toBe(true);
}

describe('compaction by policy (REQ-STOR-055)', () => {
  it('removes nothing under the default, unlimited policy', () => {
    const { history } = branched();
    const planned = plan(history, { kind: 'unlimited' });
    expect(planned.removable).toEqual([]);
    expect(planned.lost).toEqual([]);
    expect(planned.remainingBytes).toBe(5);
  });

  it('keeps the newest changes a rule names, moving the root to the state before the oldest', () => {
    const { history, nodes } = line();
    const planned = plan(history, { kind: 'rules', rules: [{ kind: 'recent-changes', count: 3 }] });
    expect(planned.newRoot).toBe(nodes[7]);
    expect(planned.removable).toEqual(nodes.slice(0, 7).toSorted());
    expect(planned.lost).toEqual([
      { kind: 'undo-before', root: nodes[7], at: EPOCH + 7 * 60_000, changes: 7 },
    ]);
    const compacted = expectSuccess(applyCompaction(history, planned));
    expectSound(compacted);
    let current = compacted;
    let undone = 0;
    for (
      let target = undoTarget(current);
      target?.parent !== undefined;
      target = undoTarget(current)
    ) {
      current = movedTo(current, target.parent);
      undone += 1;
    }
    expect(undone).toBe(3);
  });

  it('keeps every node made within the days a rule names', () => {
    const { history, nodes } = line();
    const planned = plan(
      history,
      { kind: 'rules', rules: [{ kind: 'recent-days', days: 1 }] },
      { sizeOf: () => 1, now: EPOCH + 5 * 60_000 + DAY },
    );
    expect(planned.newRoot).toBe(nodes[5]);
  });

  it('under a budget removes branches least recently used first, then the oldest changes', () => {
    const { history, node } = branched();
    const branchesOnly = plan(history, { kind: 'budget', bytes: 3 });
    expect(branchesOnly.removable).toEqual([node.b, node.c].sort());
    expect(branchesOnly.newRoot).toBeUndefined();
    expect(branchesOnly.withinBudget).toBe(true);
    expect(branchesOnly.lost).toEqual([
      {
        kind: 'branch',
        first: node.b,
        forkPoint: node.a,
        name: 'Old',
        changes: 2,
        latestAt: EPOCH + 3,
      },
    ]);

    const deeper = plan(history, { kind: 'budget', bytes: 2 });
    expect(deeper.newRoot).toBe(node.a);
    expect(deeper.removable).toEqual([node.o, node.b, node.c].sort());
    expect(deeper.remainingBytes).toBe(2);

    const impossible = plan(history, { kind: 'budget', bytes: 0 });
    expect(impossible.withinBudget).toBe(false);
    expect(impossible.newRoot).toBe(node.d);
    expect(impossible.remainingBytes).toBe(1);
  });

  it('removes nothing where the history already fits its budget', () => {
    const { history } = branched();
    expect(plan(history, { kind: 'budget', bytes: 5 }).removable).toEqual([]);
  });
});

describe('compaction the person asks for (REQ-STOR-200)', () => {
  it('removes chosen alternative branches whole', () => {
    const { history, node } = branched();
    const planned = expectSuccess(
      planCompaction(history, { kind: 'branches', firsts: [node.b] }, EACH_ONE_BYTE),
    );
    expect(planned.removable).toEqual([node.b, node.c].sort());
    expect(planned.reclaimableBytes).toBe(2);
    const compacted = expectSuccess(applyCompaction(history, planned));
    expectSound(compacted);
    expect(compacted.children.get(node.a)).toEqual([node.d]);
    expect(compacted.branchNames.size).toBe(0);
  });

  it('refuses to remove a branch holding the current state, or a node it does not hold', () => {
    const { history, node } = branched();
    expect(
      expectFailureCode(
        planCompaction(history, { kind: 'branches', firsts: [node.d] }, EACH_ONE_BYTE),
      ),
    ).toBe('compaction.branch-kept');
    expect(
      expectFailureCode(
        planCompaction(
          history,
          { kind: 'branches', firsts: [testIds(9).next<'HistoryNodeId'>()] },
          EACH_ONE_BYTE,
        ),
      ),
    ).toBe('history.unknown-node');
  });

  it('removes everything before a point, which becomes the root, and says what that costs', () => {
    const { history, node } = branched();
    const planned = expectSuccess(
      planCompaction(history, { kind: 'before', node: node.a }, EACH_ONE_BYTE),
    );
    expect(planned.newRoot).toBe(node.a);
    expect(planned.removable).toEqual([node.o]);
    expect(planned.lost).toEqual([
      { kind: 'undo-before', root: node.a, at: EPOCH + 1, changes: 1 },
    ]);
    const compacted = expectSuccess(applyCompaction(history, planned));
    expect(compacted.root).toBe(node.a);
    expect(compacted.nodes.get(node.a)).not.toHaveProperty('parent');
    expectSound(compacted);
  });

  it('counts a branch hanging from removed history as a branch lost', () => {
    const { history, node } = branched();
    const planned = expectSuccess(
      planCompaction(history, { kind: 'before', node: node.d }, EACH_ONE_BYTE),
    );
    expect(planned.lost).toEqual([
      { kind: 'undo-before', root: node.d, at: EPOCH + 4, changes: 2 },
      {
        kind: 'branch',
        first: node.b,
        forkPoint: node.a,
        name: 'Old',
        changes: 2,
        latestAt: EPOCH + 3,
      },
    ]);
  });

  it('refuses to remove history a snapshot or a protected node needs, and a point off the kept line', () => {
    const { history, ids, node } = branched();
    const snapshotted = expectSuccess(
      createSnapshot(history, {
        id: ids.next<'SnapshotId'>(),
        kind: 'recovery',
        name: expectSuccess(historyLabelFrom('Before compaction')),
        at: EPOCH + 9,
        application: 'AudioGubbins 0.1.0',
        node: node.c,
        stateFingerprint: fingerprintOf(3),
        exports: [],
      }),
    );
    expect(
      expectFailureCode(
        planCompaction(snapshotted, { kind: 'before', node: node.d }, EACH_ONE_BYTE),
      ),
    ).toBe('compaction.history-needed');
    expect(
      expectFailureCode(
        planCompaction(
          history,
          { kind: 'before', node: node.d },
          { ...EACH_ONE_BYTE, protectedNodes: [node.b] },
        ),
      ),
    ).toBe('compaction.history-needed');
    expect(
      expectFailureCode(planCompaction(history, { kind: 'before', node: node.b }, EACH_ONE_BYTE)),
    ).toBe('compaction.history-needed');
    expect(
      expectSuccess(planCompaction(history, { kind: 'before', node: node.o }, EACH_ONE_BYTE))
        .removable,
    ).toEqual([]);
  });

  it('names each export whose state would be lost', () => {
    const { history, ids, node } = branched();
    const record: ExportRecord = {
      id: ids.next<'ExportRecordId'>(),
      at: EPOCH + 5,
      stateFingerprint: fingerprintOf(3),
      historyNodeId: node.c,
      engineVersions: new Map(),
      output: { container: 'wav', settings: new Map() },
      destination: { kind: ExportDestinationKind.Directory },
      status: ExportStatus.Succeeded,
      problems: [],
    };
    const planned = expectSuccess(
      planCompaction(
        history,
        { kind: 'branches', firsts: [node.b] },
        { ...EACH_ONE_BYTE, exports: [record] },
      ),
    );
    expect(planned.lost.at(-1)).toEqual({ kind: 'export-state', export: record.id, node: node.c });
  });
});

describe('applying a compaction', () => {
  it('refuses a plan the history has moved on from, applying none of it', () => {
    const { history, ids, node } = branched();
    const planned = expectSuccess(
      planCompaction(history, { kind: 'branches', firsts: [node.b] }, EACH_ONE_BYTE),
    );
    const onC = movedTo(history, node.c);
    expect(expectFailureCode(applyCompaction(onC, planned))).toBe('compaction.stale-plan');
    const grownUnderC = movedTo(grown(onC, ids.next<'HistoryNodeId'>(), 'E'), node.d);
    expect(expectFailureCode(applyCompaction(grownUnderC, planned))).toBe('compaction.stale-plan');
    const foreign = { ...planned, project: unsafeBrandId<'ProjectId'>('ffffffff-0000') };
    expect(expectFailureCode(applyCompaction(history, foreign))).toBe('compaction.stale-plan');
    const unknown = { ...planned, removable: [testIds(8).next<'HistoryNodeId'>()] };
    expect(expectFailureCode(applyCompaction(history, unknown))).toBe('compaction.stale-plan');
  });
});

describe('every compaction plan, over random histories', () => {
  it('keeps the current line, snapshots and protected nodes, and leaves one tree', () => {
    let removedInAll = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const random = seededRandom(seed * 7919);
      const history = randomHistory(seed, 20 + random.below(100));
      const all = [...history.nodes.keys()];
      const protectedNodes = all.filter(() => random.next() < 0.05);
      const policies: readonly RetentionPolicy[] = [
        { kind: 'budget', bytes: random.below(all.length * 3) },
        { kind: 'rules', rules: [{ kind: 'recent-changes', count: 1 + random.below(10) }] },
        { kind: 'rules', rules: [{ kind: 'recent-days', days: 1 }] },
      ];
      const context: CompactionContext = {
        sizeOf: (node) => 1 + (node.at % 3),
        now: EPOCH + 20 * 60_000 + DAY,
        protectedNodes,
      };
      const pinned = pinnedNodes(history, protectedNodes);
      const line = new Set(activeLine(history).map((node) => node.id));
      for (const policy of policies) {
        const planned = plan(history, policy, context);
        for (const id of planned.removable) expect(pinned.has(id)).toBe(false);
        let total = 0;
        for (const node of history.nodes.values()) total += context.sizeOf(node);
        expect(planned.reclaimableBytes + planned.remainingBytes).toBe(total);
        if (policy.kind === 'budget' && planned.withinBudget) {
          expect(planned.remainingBytes).toBeLessThanOrEqual(policy.bytes);
        }

        const compacted = expectSuccess(applyCompaction(history, planned));
        expectSound(compacted);
        expect(compacted.cursor).toBe(history.cursor);
        expect(compacted.nodes.size).toBe(history.nodes.size - planned.removable.length);
        removedInAll += planned.removable.length;
        for (const id of pinned) expect(compacted.nodes.has(id)).toBe(true);
        for (const id of protectedNodes) expect(compacted.nodes.has(id)).toBe(true);
        for (const snapshot of history.snapshots.values()) {
          expect(compacted.nodes.has(snapshot.node)).toBe(true);
        }
        const lostBranches = planned.lost.flatMap((lost) =>
          lost.kind === 'branch' ? [lost.changes] : [],
        );
        const lostAbove = planned.lost.flatMap((lost) =>
          lost.kind === 'undo-before' ? [lost.changes] : [],
        );
        expect([...lostBranches, ...lostAbove].reduce((sum, count) => sum + count, 0)).toBe(
          planned.removable.length,
        );
        for (const id of compacted.nodes.keys()) {
          if (line.has(id)) expect(activeLine(compacted).some((node) => node.id === id)).toBe(true);
        }
      }
    }
    expect(removedInAll).toBeGreaterThan(1_000);
  });
});
