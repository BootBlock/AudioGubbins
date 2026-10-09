import { describe, expect, it } from 'vitest';

import type { RegionId, TakeStackId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  ExportDestinationKind,
  ExportStatus,
  historyLabelFrom,
  type ExportRecord,
  type HistoryNodeId,
} from '@audiogubbins/project-format';

import { changeNodeOf, nameBranch, recordChange, type History } from './history.js';
import { affectedEntities, type HistoryRow } from './history-rows.js';
import { createSnapshot } from './snapshots.js';
import {
  EPOCH,
  NOTHING_AFFECTED,
  fingerprintOf,
  grown,
  invocation,
  movedTo,
  newHistory,
  testIds,
  rowsOf,
} from './testing/histories.js';

const ids = testIds(51);
const region: RegionId = ids.next<'RegionId'>();

/**
 * O → A → B → C, with D from A (named "Darker") and E from D's parent A too;
 * the cursor is at C. B moved region R; C has a snapshot.
 */
function setUp(): {
  history: History;
  node: Record<'o' | 'a' | 'b' | 'c' | 'd' | 'e', HistoryNodeId>;
} {
  const start = newHistory(ids);
  const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(() => ids.next<'HistoryNodeId'>());
  if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
    throw new Error('Five identifiers were asked for.');
  }
  let history = grown(start, a, 'Trim start');
  history = expectSuccess(
    recordChange(
      history,
      changeNodeOf(history, {
        id: b,
        at: EPOCH + 10,
        entry: {
          description: 'Move region',
          forward: [invocation('move', 'b')],
          inverse: [invocation('move-back', 'b')],
        },
        affects: { ...NOTHING_AFFECTED, regions: [region] },
      }),
    ),
  );
  history = grown(history, c, 'Normalise loudness');
  history = grown(movedTo(history, a), d, 'Darker EQ');
  history = expectSuccess(nameBranch(history, d, expectSuccess(historyLabelFrom('Darker'))));
  history = grown(movedTo(history, a), e, 'Brighter EQ');
  history = movedTo(history, c);
  history = expectSuccess(
    createSnapshot(history, {
      id: ids.next<'SnapshotId'>(),
      kind: 'named',
      name: expectSuccess(historyLabelFrom('Approved game export')),
      notes: 'Sent to the team.',
      at: EPOCH + 100,
      application: 'AudioGubbins 0.1.0',
      node: c,
      stateFingerprint: fingerprintOf(3),
      exports: [],
    }),
  );
  return { history, node: { o: start.root, a, b, c, d, e } };
}

function shape(rows: readonly HistoryRow[]): readonly (readonly [string, number, string])[] {
  return rows.map((row) => [
    row.node.kind === 'change' ? row.node.description : 'origin',
    row.depth,
    `${row.isCurrent ? 'current ' : ''}${row.isOnActiveLine ? 'active' : 'alternative'}`,
  ]);
}

describe('the History panel’s rows (REQ-STOR-196)', () => {
  it('put branches beside the point they leave, oldest first and a level deeper', () => {
    const { history, node } = setUp();
    const rows = rowsOf(history);
    expect(shape(rows)).toEqual([
      ['origin', 0, 'active'],
      ['Trim start', 0, 'active'],
      ['Darker EQ', 1, 'alternative'],
      ['Brighter EQ', 1, 'alternative'],
      ['Move region', 0, 'active'],
      ['Normalise loudness', 0, 'current active'],
    ]);
    const darker = rows.find((row) => row.node.id === node.d);
    expect(darker?.forkPoint).toBe(node.a);
    expect(darker?.branchName).toBe('Darker');
    expect(rows.find((row) => row.node.id === node.a)?.childCount).toBe(3);
    expect(rows.find((row) => row.node.id === node.c)?.snapshots.map((s) => s.name)).toEqual([
      'Approved game export',
    ]);
  });

  it('are the same whichever way the history was reached', () => {
    const { history, node } = setUp();
    const again = movedTo(movedTo(history, node.e), node.c);
    expect(rowsOf(again)).toEqual(rowsOf(history));
  });

  it('show the exports made from each node, as provenance', () => {
    const { history, node } = setUp();
    const record: ExportRecord = {
      id: ids.next<'ExportRecordId'>(),
      at: EPOCH + 200,
      stateFingerprint: fingerprintOf(3),
      historyNodeId: node.c,
      engineVersions: new Map(),
      output: { container: 'ogg', settings: new Map() },
      destination: { kind: ExportDestinationKind.Download },
      status: ExportStatus.Succeeded,
      problems: [],
    };
    const rows = rowsOf(history, {}, { exports: [record] });
    expect(rows.find((row) => row.node.id === node.c)?.exports).toEqual([record]);
    expect(rows.filter((row) => row.exports.length > 0)).toHaveLength(1);
  });

  it('are found by words in a description, a branch name, a snapshot or an entity’s name', () => {
    const { history, node } = setUp();
    const found = (text: string, nameOf?: () => string | undefined): readonly HistoryNodeId[] =>
      rowsOf(history, { text }, nameOf === undefined ? {} : { nameOf }).map((row) => row.node.id);
    expect(found('BRIGHTER')).toEqual([node.e]);
    expect(found('darker')).toEqual([node.d]);
    expect(found('sent to the team')).toEqual([node.c]);
    expect(found('walk loop', () => 'Walk loop')).toEqual([node.b]);
    expect(found('   ')).toHaveLength(6);
    expect(found('nothing like this')).toEqual([]);
  });

  it('are filtered to the active line, to snapshots, or to the changes that affected an entity', () => {
    const { history, node } = setUp();
    expect(rowsOf(history, { scope: 'active-line' }).map((row) => row.node.id)).toEqual([
      node.o,
      node.a,
      node.b,
      node.c,
    ]);
    expect(rowsOf(history, { scope: 'snapshots' }).map((row) => row.node.id)).toEqual([node.c]);
    expect(
      rowsOf(history, { affecting: { kind: 'region', id: region } }).map((row) => row.node.id),
    ).toEqual([node.b]);
    expect(rowsOf(history, { affecting: { kind: 'clip', id: region } })).toEqual([]);
  });

  it('are filtered to the changes that affected a take stack, which each names', () => {
    const generator = testIds(53);
    const stack: TakeStackId = generator.next<'TakeStackId'>();
    const chosen = generator.next<'HistoryNodeId'>();
    let history = grown(newHistory(generator), generator.next<'HistoryNodeId'>(), 'Trim start');
    history = expectSuccess(
      recordChange(
        history,
        changeNodeOf(history, {
          id: chosen,
          at: EPOCH + 10,
          entry: {
            description: 'Choose take',
            forward: [invocation('choose', 'take')],
            inverse: [invocation('choose-back', 'take')],
          },
          affects: { ...NOTHING_AFFECTED, takeStacks: [stack] },
        }),
      ),
    );
    const rows = rowsOf(history, { affecting: { kind: 'take-stack', id: stack } });
    expect(rows.map((row) => row.node.id)).toEqual([chosen]);
    const [row] = rows;
    if (row === undefined) throw new Error('One change affected the stack.');
    expect([...affectedEntities(row.node)]).toEqual([{ kind: 'take-stack', id: stack }]);
  });

  it('list a history ten thousand changes long without indenting it', () => {
    const generator = testIds(52);
    let history = newHistory(generator);
    for (let step = 0; step < 10_000; step += 1) {
      history = grown(history, generator.next<'HistoryNodeId'>(), `Step ${String(step)}`);
    }
    const rows = rowsOf(history);
    expect(rows).toHaveLength(10_001);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
    expect(rows.at(-1)?.isCurrent).toBe(true);
  });
});
