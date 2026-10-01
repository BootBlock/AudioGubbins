import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  canonicalJson,
  readHistoryNodeRecord,
  readHistoryRecord,
  startReading,
  writeHistoryNodeRecord,
  writeHistoryRecord,
  type HistoryRecord,
} from '@audiogubbins/project-format';

import { historyFromRecord, historyRecordOf, nodeFromRecord } from './history-conversion.js';
import type { History } from './history.js';
import { historyRows } from './history-rows.js';
import { activeLine } from './lines.js';
import { redoTarget } from './navigation.js';
import { grown, movedTo, newHistory, randomHistory, testIds } from './testing/histories.js';

/** The history written as JSON and read back. */
function throughJson(history: History): History {
  const reading = startReading();
  const read = expectSuccess(
    reading.outcome(
      readHistoryRecord(reading, writeHistoryRecord(historyRecordOf(history)), '', 'history'),
    ),
  );
  return expectSuccess(historyFromRecord(read));
}

describe('a history kept and read back', () => {
  it('is the same history, over random histories', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const history = randomHistory(seed, 10 + seed * 3);
      const read = throughJson(history);
      expect(read.root).toBe(history.root);
      expect(read.cursor).toBe(history.cursor);
      expect(new Map(read.nodes.entries())).toEqual(new Map(history.nodes.entries()));
      expect(read.snapshots).toEqual(history.snapshots);
      expect(read.branchNames).toEqual(history.branchNames);
      expect(activeLine(read)).toEqual(activeLine(history));
      expect(historyRows(read)).toEqual(historyRows(history));
      expect(canonicalJson(writeHistoryRecord(historyRecordOf(read)))).toBe(
        canonicalJson(writeHistoryRecord(historyRecordOf(history))),
      );
    }
  });

  it('redoes along the child visited last, not the newest, once read back', () => {
    const ids = testIds(81);
    const start = newHistory(ids);
    const a = ids.next<'HistoryNodeId'>();
    const b = ids.next<'HistoryNodeId'>();
    const c = ids.next<'HistoryNodeId'>();
    let history = grown(grown(start, a, 'A'), b, 'B');
    history = grown(movedTo(history, a), c, 'C');
    history = movedTo(movedTo(history, b), a);
    expect(redoTarget(history)?.id).toBe(b);
    expect(redoTarget(throughJson(history))?.id).toBe(b);
    const forgetful: HistoryRecord = { ...historyRecordOf(history), preferred: new Map() };
    expect(redoTarget(expectSuccess(historyFromRecord(forgetful)))?.id).toBe(c);
  });

  it('stores no preference for a line of changes, and redoes along it once read back', () => {
    const ids = testIds(84);
    const start = newHistory(ids);
    let history = start;
    for (const step of ['A', 'B', 'C', 'D', 'E']) {
      history = grown(history, ids.next<'HistoryNodeId'>(), step);
    }
    const end = history.cursor;
    expect(historyRecordOf(history).preferred.size).toBe(0);
    let read = movedTo(throughJson(history), start.root);
    for (let step = 0; step < 5; step += 1) {
      const next = redoTarget(read);
      if (next === undefined) throw new Error('A line of five changes redoes five times.');
      read = movedTo(read, next.id);
    }
    expect(read.cursor).toBe(end);
  });

  it('stores a preference for a child recorded later but dated earlier than its sibling', () => {
    const ids = testIds(85);
    const start = newHistory(ids);
    const later = ids.next<'HistoryNodeId'>();
    const earlier = ids.next<'HistoryNodeId'>();
    // The clock went back between the two: the second recorded is dated first,
    // so a reader that orders children by date takes the first as the newest.
    let history = grown(start, later, 'Later', start.nodes.size + 2_000_000_000_000);
    history = grown(movedTo(history, start.root), earlier, 'Earlier', 1_000_000_000_000);
    history = movedTo(history, start.root);
    expect(redoTarget(history)?.id).toBe(earlier);
    expect([...historyRecordOf(history).preferred]).toEqual([[start.root, earlier]]);
    expect(redoTarget(throughJson(history))?.id).toBe(earlier);
  });

  it('refuses a stored change naming a command by something that is not a command identifier', () => {
    const ids = testIds(82);
    const history = grown(newHistory(ids), ids.next<'HistoryNodeId'>(), 'A');
    const node = history.nodes.get(history.cursor);
    if (node?.kind !== 'change') throw new Error('The cursor is a change.');
    const bad = { ...node, inverse: [{ commandId: 'Not An Identifier' }] as const };
    expect(expectFailureCode(nodeFromRecord(bad))).toBe('history.malformed-command-id');
    const badForward = { ...node, forward: [node.forward[0], { commandId: '9bad' }] as const };
    expect(expectFailureCode(nodeFromRecord(badForward))).toBe('history.malformed-command-id');
    expect(
      expectFailureCode(historyFromRecord({ ...historyRecordOf(history), nodes: [bad] })),
    ).toBe('history.malformed-command-id');
  });

  it('reads a journal’s node record back as the node, its invocations branded', () => {
    const ids = testIds(83);
    const history = grown(newHistory(ids), ids.next<'HistoryNodeId'>(), 'A');
    const node = history.nodes.get(history.cursor);
    if (node === undefined) throw new Error('The cursor is a node.');
    const reading = startReading();
    const record = expectSuccess(
      reading.outcome(readHistoryNodeRecord(reading, writeHistoryNodeRecord(node), '', 'node')),
    );
    expect(expectSuccess(nodeFromRecord(record))).toEqual(node);
    const origin = history.nodes.get(history.root);
    if (origin === undefined) throw new Error('The root is a node.');
    expect(expectSuccess(nodeFromRecord(origin))).toBe(origin);
  });
});
