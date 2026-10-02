import { describe, expect, it } from 'vitest';

import { commandId } from '@audiogubbins/commands';
import { createDeterministicIdGenerator } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  applyCompaction,
  changeNodeOf,
  recordChange,
  startHistory,
  withStateFingerprint,
  type History,
  type HistoryNode,
} from '@audiogubbins/history';
import {
  Turns,
  stateFingerprintFrom,
  type HistoryNodeId,
  type StateFingerprint,
} from '@audiogubbins/project-format';
import { immediateTurns } from '@audiogubbins/project-format/testing';

import { SEGMENT_LENGTH, SegmentLedger, type SegmentPlan } from './segment-ledger.js';

const EPOCH = 1_790_000_000_000;
const ids = createDeterministicIdGenerator(41);
const PROJECT = ids.next<'ProjectId'>();
const RENAME = commandId('project.rename');

function fingerprint(value: number): StateFingerprint {
  return expectSuccess(stateFingerprintFrom(`s1-${value.toString(16).padStart(64, '0')}`));
}

function started(): History {
  return startHistory(PROJECT, {
    kind: 'origin',
    id: ids.next<'HistoryNodeId'>(),
    at: EPOCH,
    origin: { kind: 'new' },
  });
}

/** The history with `count` changes recorded in a line at its cursor. */
function grownBy(history: History, count: number): History {
  let grown = history;
  for (let step = 0; step < count; step += 1) {
    const node = changeNodeOf(grown, {
      id: ids.next<'HistoryNodeId'>(),
      at: EPOCH + grown.nodes.size,
      entry: {
        description: 'Rename',
        forward: [{ commandId: RENAME, arguments: { name: 'After' } }],
        inverse: [{ commandId: RENAME, arguments: { name: 'Before' } }],
      },
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
    });
    grown = expectSuccess(recordChange(grown, node));
  }
  return grown;
}

/** Each node measured as `length` long. */
function measuredAs(length: number): (node: HistoryNode) => number {
  return () => length;
}

/** Plans a checkpoint, takes its new segments as written and confirmed, and gives the plan. */
async function checkpointed(
  ledger: SegmentLedger,
  history: History,
  measure: (node: HistoryNode) => number,
): Promise<SegmentPlan> {
  const plan = await ledger.plan(history, measure, new Turns(immediateTurns));
  ledger.commit(
    plan,
    plan.fresh.map((fresh) => ({
      reference: { epoch: 1, id: ids.next<'HistorySegmentId'>() },
      nodes: fresh.nodes,
      length: fresh.length,
    })),
  );
  return plan;
}

/** The identifiers of the line from the root, in order. */
function lineOf(history: History): HistoryNodeId[] {
  const line: HistoryNodeId[] = [];
  for (let id: HistoryNodeId | undefined = history.root; id !== undefined;) {
    line.push(id);
    id = history.children.get(id)?.[0];
  }
  return line;
}

/** The history with the first `removed` nodes of its line compacted away. */
function compactedTo(history: History, removed: number): History {
  const line = lineOf(history);
  const newRoot = line[removed];
  if (newRoot === undefined) throw new Error('The line is longer than what is removed.');
  return expectSuccess(
    applyCompaction(history, {
      project: PROJECT,
      removable: line.slice(0, removed),
      newRoot,
      reclaimableBytes: 0,
      remainingBytes: 0,
      withinBudget: true,
      lost: [],
    }),
  );
}

/** Every node the plan's segments hold, kept and fresh, sorted. */
function heldBy(plan: SegmentPlan): HistoryNodeId[] {
  return [
    ...plan.kept.flatMap((segment) => segment.nodes),
    ...plan.fresh.flatMap((fresh) => fresh.nodes.map((node) => node.id)),
  ].sort();
}

const QUARTER = SEGMENT_LENGTH / 4;

describe('planning the segments of a checkpoint', () => {
  it('writes only the nodes added since the last checkpoint once the newest segment is full', async () => {
    const ledger = new SegmentLedger();
    const first = grownBy(started(), 10);
    expect((await checkpointed(ledger, first, measuredAs(QUARTER))).fresh).toHaveLength(3);

    const second = grownBy(first, 3);
    const plan = await ledger.plan(second, measuredAs(QUARTER), new Turns(immediateTurns));
    expect(plan.kept).toEqual(ledger.named);
    expect(plan.fresh.flatMap((fresh) => fresh.nodes.map((node) => node.id))).toEqual(
      lineOf(second).slice(-3),
    );
    expect(heldBy(plan)).toEqual([...lineOf(second)].sort());
  });

  it('writes the newest segment again with the new nodes while both fit in one', async () => {
    const ledger = new SegmentLedger();
    const first = grownBy(started(), 10);
    await checkpointed(ledger, first, measuredAs(100));
    const second = grownBy(first, 3);
    const plan = await ledger.plan(second, measuredAs(100), new Turns(immediateTurns));
    expect(plan.kept).toEqual([]);
    expect(plan.fresh).toHaveLength(1);
    expect(plan.fresh[0]?.length).toBe(1_400);
    expect(heldBy(plan)).toEqual([...lineOf(second)].sort());
  });

  it('writes again only the segments compaction removed nodes from or moved the root into', async () => {
    const ledger = new SegmentLedger();
    const history = grownBy(started(), 10);
    await checkpointed(ledger, history, measuredAs(QUARTER));
    const [touched, untouched] = ledger.named;
    const line = lineOf(history);
    const compacted = compactedTo(history, 2);
    const plan = await ledger.plan(compacted, measuredAs(QUARTER), new Turns(immediateTurns));
    expect(plan.kept).toContain(untouched);
    expect(plan.kept).not.toContain(touched);
    expect(heldBy(plan)).toEqual([...lineOf(compacted)].sort());
    const rewritten = plan.fresh.flatMap((fresh) => fresh.nodes);
    expect(rewritten.find((node) => node.id === line[2])).toEqual(
      compacted.nodes.get(compacted.root),
    );
  });

  it('writes again a segment compaction removed nothing from but moved the root into', async () => {
    const ledger = new SegmentLedger();
    const history = grownBy(started(), 10);
    await checkpointed(ledger, history, measuredAs(QUARTER));
    const [gone, rooted, untouched] = ledger.named;
    const line = lineOf(history);
    // The first segment holds the first four nodes: all of it goes, and the
    // fifth, first in the second segment, becomes the root.
    expect(gone?.nodes).toEqual(line.slice(0, 4));
    const compacted = compactedTo(history, 4);
    const plan = await ledger.plan(compacted, measuredAs(QUARTER), new Turns(immediateTurns));
    expect(plan.kept).toEqual([untouched]);
    expect(plan.kept).not.toContain(rooted);
    expect(heldBy(plan)).toEqual([...lineOf(compacted)].sort());
  });

  it('carries a fingerprint learned after its node’s segment was written', async () => {
    const ledger = new SegmentLedger();
    const history = grownBy(started(), 10);
    await checkpointed(ledger, history, measuredAs(QUARTER));
    const node = lineOf(history)[5];
    if (node === undefined) throw new Error('The line has eleven nodes.');
    const learned = expectSuccess(withStateFingerprint(history, node, fingerprint(5)));
    const plan = await ledger.plan(learned, measuredAs(QUARTER), new Turns(immediateTurns));
    expect(plan.kept).toEqual(ledger.named);
    expect(plan.fresh).toEqual([]);
    expect([...plan.fingerprints]).toEqual([[node, fingerprint(5)]]);
  });

  it('keeps at most two segments for each segment length of history, however often it checkpoints', async () => {
    const ledger = new SegmentLedger();
    let history = started();
    const each = 1_000;
    for (let checkpoint = 0; checkpoint < 2_000; checkpoint += 1) {
      history = grownBy(history, 1);
      await checkpointed(ledger, history, measuredAs(each));
    }
    const lengths = (history.nodes.size * each) / SEGMENT_LENGTH;
    expect(ledger.named.length).toBeLessThanOrEqual(2 * Math.ceil(lengths));
    expect((await ledger.plan(history, measuredAs(each), new Turns(immediateTurns))).fresh).toEqual(
      [],
    );
  });
});
