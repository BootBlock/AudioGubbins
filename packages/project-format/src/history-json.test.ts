import { describe, expect, it } from 'vitest';

import { createDeterministicIdGenerator, type IdGenerator } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { canonicalJson, type JsonValue } from './canonical-json.js';
import { stateFingerprintFrom, type StateFingerprint } from './content-identity.js';
import { startReading } from './document-reading.js';
import { readHistoryRecord, writeHistoryRecord } from './history-json.js';
import { readHistoryNodeRecord, writeHistoryNodeRecord } from './history-node-json.js';
import {
  historyLabelFrom,
  type ChangeNodeRecord,
  type HistoryLabel,
  type HistoryNodeId,
  type HistoryNodeRecord,
  type HistoryRecord,
  type InvocationRecord,
  type NamedSnapshot,
  type RetentionPolicy,
} from './history-record.js';
import { parseJson } from './json-parsing.js';
import { readRetentionPolicy, writeRetentionPolicy } from './retention-json.js';
import { readSnapshotRecord, writeSnapshotRecord } from './snapshot-json.js';
import { edited, withValue, without } from './testing/json-editing.js';
import { seededRandom, type Random } from './testing/random-values.js';

const EPOCH = 1_790_000_000_000;

function fingerprint(value: number): StateFingerprint {
  return expectSuccess(stateFingerprintFrom(`s1-${value.toString(16).padStart(64, '0')}`));
}

function label(text: string): HistoryLabel {
  return expectSuccess(historyLabelFrom(text));
}

const EMPTY_AFFECTS = {
  assets: [],
  tracks: [],
  buses: [],
  clips: [],
  regions: [],
  markers: [],
  effectChains: [],
  project: false,
};

/** O → A → B → C, the cursor at C, a snapshot at B. */
function fixedRecord(): HistoryRecord {
  const ids = createDeterministicIdGenerator(5);
  const [o, a, b, c] = [0, 1, 2, 3].map(() => ids.next<'HistoryNodeId'>());
  if (o === undefined || a === undefined || b === undefined || c === undefined) throw new Error();
  const change = (id: HistoryNodeId, parent: HistoryNodeId, step: number): ChangeNodeRecord => ({
    kind: 'change',
    id,
    parent,
    at: EPOCH + step,
    description: `Step ${String(step)}`,
    forward: [{ commandId: 'project.rename', arguments: { name: `Take ${String(step)}` } }],
    inverse: [{ commandId: 'project.rename', arguments: { name: 'Before' } }],
    affects: { ...EMPTY_AFFECTS, project: true },
  });
  return {
    project: ids.next<'ProjectId'>(),
    nodes: [
      { kind: 'origin', id: o, at: EPOCH, origin: { kind: 'new' } },
      change(a, o, 1),
      { ...change(b, a, 2), stateFingerprint: fingerprint(2) },
      change(c, b, 3),
    ],
    cursor: c,
    preferred: new Map([[a, b]]),
    branchNames: new Map([[a, label('Main idea')]]),
    snapshots: [
      {
        id: ids.next<'SnapshotId'>(),
        kind: 'named',
        name: label('Client version 2'),
        at: EPOCH + 5,
        application: 'AudioGubbins 0.1.0',
        node: b,
        stateFingerprint: fingerprint(2),
        exports: [],
      },
    ],
  };
}

/** A record read from a value, or every problem's code and place. */
function read(value: JsonValue): HistoryRecord | readonly (readonly [string, unknown])[] {
  const reading = startReading();
  const result = reading.outcome(readHistoryRecord(reading, value, '', 'history'));
  return result.ok
    ? result.value
    : result.failures.map((problem) => [problem.code, problem.details?.['at']] as const);
}

/** The codes of every problem reading a value finds, or none. */
function codesOf(value: JsonValue): readonly string[] {
  const reading = startReading();
  const result = reading.outcome(readHistoryRecord(reading, value, '', 'history'));
  return result.ok ? [] : result.failures.map((problem) => problem.code);
}

/** The history written, read back through JSON text. */
function roundTrip(record: HistoryRecord): HistoryRecord | readonly (readonly [string, unknown])[] {
  const text = canonicalJson(writeHistoryRecord(record));
  return read(expectSuccess(parseJson(text, { maximumLength: 2 ** 26, maximumDepth: 16 })));
}

const TEXTS = ['Take', 'é', '中文', '🎵', '"', '\\', '\n', '\u0001', '', 'x'.repeat(300)];

function randomInvocation(random: Random): InvocationRecord {
  const count = random.below(4);
  if (count === 0) return { commandId: 'test.do' };
  const entries: [string, string | number | boolean | null][] = [];
  for (let index = 0; index < count; index += 1) {
    const choice = random.below(4);
    entries.push([
      `argument${String(index)}`,
      choice === 0
        ? random.pick(TEXTS)
        : choice === 1
          ? random.pick([0, -1, 0.5, 1e21, 5e-324, 2 ** 53 - 1])
          : choice === 2
            ? random.chance(0.5)
            : null,
    ]);
  }
  return {
    commandId: random.pick(['test.do', 'project.add-region', 'edit.move-clip']),
    arguments: Object.fromEntries(entries),
  };
}

/** A random history record: a random tree with every kind of member. */
function randomRecord(seed: number): HistoryRecord {
  const random = seededRandom(seed);
  const ids: IdGenerator = createDeterministicIdGenerator(seed);
  const root = ids.next<'HistoryNodeId'>();
  const nodes: HistoryNodeRecord[] = [
    {
      kind: 'origin',
      id: root,
      at: EPOCH,
      origin: random.chance(0.5)
        ? {
            kind: 'fork',
            project: ids.next<'ProjectId'>(),
            node: ids.next<'HistoryNodeId'>(),
            stateFingerprint: fingerprint(0),
          }
        : { kind: random.pick(['new', 'import'] as const) },
    },
  ];
  const size = 5 + random.below(60);
  for (let index = 1; index < size; index += 1) {
    const parent = random.pick(nodes).id;
    nodes.push({
      kind: 'change',
      id: ids.next<'HistoryNodeId'>(),
      parent,
      at: EPOCH + index,
      description: random.pick(TEXTS),
      forward: [randomInvocation(random), randomInvocation(random)],
      inverse: [randomInvocation(random)],
      affects: {
        ...EMPTY_AFFECTS,
        clips: random.chance(0.5) ? [ids.next<'ClipId'>()] : [],
        regions: random.chance(0.3) ? [ids.next<'RegionId'>(), ids.next<'RegionId'>()] : [],
        project: random.chance(0.2),
      },
      ...(random.chance(0.3) ? { stateFingerprint: fingerprint(index) } : {}),
    });
  }
  const preferred = new Map<HistoryNodeId, HistoryNodeId>();
  const branchNames = new Map<HistoryNodeId, HistoryLabel>();
  const snapshots: NamedSnapshot[] = [];
  for (const node of nodes) {
    if (node.kind === 'change' && node.parent !== undefined && random.chance(0.3)) {
      preferred.set(node.parent, node.id);
    }
    if (random.chance(0.1)) branchNames.set(node.id, label(`Branch ${node.id}`));
    if (random.chance(0.1)) {
      snapshots.push({
        id: ids.next<'SnapshotId'>(),
        kind: random.pick(['named', 'recovery'] as const),
        name: label('Before aggressive denoise'),
        ...(random.chance(0.5) ? { notes: random.pick(TEXTS) } : {}),
        at: node.at + 1,
        ...(random.chance(0.5) ? { author: 'Sound designer' } : {}),
        application: 'AudioGubbins 0.1.0',
        node: node.id,
        stateFingerprint: node.stateFingerprint ?? fingerprint(10_000 + snapshots.length),
        exports: random.chance(0.5) ? [ids.next<'ExportRecordId'>()] : [],
      });
    }
  }
  const snapshotted = new Map(
    snapshots.map((snapshot) => [snapshot.node, snapshot.stateFingerprint]),
  );
  return {
    project: ids.next<'ProjectId'>(),
    nodes: nodes.map((node) => {
      const state = snapshotted.get(node.id);
      return state === undefined ? node : { ...node, stateFingerprint: state };
    }),
    cursor: random.pick(nodes).id,
    preferred,
    branchNames,
    snapshots,
  };
}

describe('a history as JSON (REQ-STOR-193, REQ-EXEC-136.12)', () => {
  it('reads back as the history written, over random histories', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const record = randomRecord(seed);
      const back = roundTrip(record);
      expect(back).toEqual({
        ...record,
        nodes: [...record.nodes].sort((left, right) => (left.id < right.id ? -1 : 1)),
        snapshots: [...record.snapshots].sort((left, right) => (left.id < right.id ? -1 : 1)),
      });
    }
  });

  it('gives the same text whatever order its maps and lists were built in', () => {
    const record = fixedRecord();
    const reordered: HistoryRecord = {
      ...record,
      nodes: [...record.nodes].reverse(),
      preferred: new Map([...record.preferred].reverse()),
    };
    expect(canonicalJson(writeHistoryRecord(reordered))).toBe(
      canonicalJson(writeHistoryRecord(record)),
    );
  });

  it('writes only the affected lists that hold something', () => {
    const node = fixedRecord().nodes[1];
    if (node === undefined) throw new Error('The fixed record has four nodes.');
    expect(writeHistoryNodeRecord(node)['affects']).toEqual({ project: true });
  });

  const nodeAt = (index: number, member: string): readonly (string | number)[] => [
    'nodes',
    index,
    member,
  ];
  const sortedIds = (): readonly string[] =>
    fixedRecord()
      .nodes.map((node) => node.id)
      .sort();
  const indexOf = (position: number): number => {
    const record = fixedRecord();
    const id = record.nodes[position]?.id ?? '';
    return sortedIds().indexOf(id);
  };
  const written = (): JsonValue => writeHistoryRecord(fixedRecord());
  const stranger = createDeterministicIdGenerator(999).next<'HistoryNodeId'>();

  it.each([
    [
      'a parent it does not hold',
      () => withValue(written(), nodeAt(indexOf(2), 'parent'), stranger),
      'history.missing-parent',
    ],
    ['two roots', () => without(written(), nodeAt(indexOf(1), 'parent')), 'history.not-one-root'],
    [
      'a cycle',
      () => withValue(written(), nodeAt(indexOf(1), 'parent'), fixedRecord().nodes[3]?.id ?? ''),
      'history.cycle',
    ],
    [
      'a node its own parent',
      () => withValue(written(), nodeAt(indexOf(1), 'parent'), fixedRecord().nodes[1]?.id ?? ''),
      'history.own-parent',
    ],
    [
      'a cursor at no node',
      () => withValue(written(), ['cursor'], stranger),
      'history.unknown-node',
    ],
    [
      'a preference for a node that is not a child',
      () => withValue(written(), ['preferred', 0, 'child'], fixedRecord().nodes[3]?.id ?? ''),
      'history.preferred-not-a-child',
    ],
    [
      'a branch name on no node',
      () => withValue(written(), ['branchNames', 0, 'node'], stranger),
      'history.unknown-node',
    ],
    [
      'a snapshot of no node',
      () => withValue(written(), ['snapshots', 0, 'node'], stranger),
      'history.unknown-node',
    ],
    [
      'a snapshot whose fingerprint its node contradicts',
      () => withValue(written(), ['snapshots', 0, 'stateFingerprint'], fingerprint(3)),
      'history.snapshot-fingerprint-mismatch',
    ],
    [
      'a node listed twice',
      () =>
        edited(written(), ['nodes'], (nodes) =>
          Array.isArray(nodes) ? [...nodes, nodes[0]] : nodes,
        ),
      'schema.duplicate-id',
    ],
    [
      'a snapshot listed twice',
      () =>
        edited(written(), ['snapshots'], (list) =>
          Array.isArray(list) ? [...list, list[0]] : list,
        ),
      'schema.duplicate-id',
    ],
    [
      'a node preferred twice',
      () =>
        edited(written(), ['preferred'], (list) =>
          Array.isArray(list) ? [...list, list[0]] : list,
        ),
      'schema.duplicate-id',
    ],
    [
      'an origin with a parent',
      () => withValue(written(), nodeAt(indexOf(0), 'parent'), fixedRecord().nodes[1]?.id ?? ''),
      'schema.unknown-member',
    ],
    [
      'a node of an unknown kind',
      () => withValue(written(), nodeAt(indexOf(1), 'kind'), 'merge'),
      'schema.unknown-value',
    ],
    [
      'a malformed command identifier',
      () => withValue(written(), [...nodeAt(indexOf(1), 'forward'), 0, 'commandId'], 'Rename'),
      'schema.text-malformed',
    ],
    [
      'a change with no invocation',
      () => withValue(written(), nodeAt(indexOf(1), 'inverse'), []),
      'history.no-invocation',
    ],
    [
      'an argument that is an object',
      () => withValue(written(), [...nodeAt(indexOf(1), 'forward'), 0, 'arguments', 'name'], {}),
      'schema.unknown-value',
    ],
    [
      'an argument with a malformed name',
      () =>
        withValue(written(), [...nodeAt(indexOf(1), 'forward'), 0, 'arguments'], {
          'no spaces': 1,
        }),
      'schema.text-malformed',
    ],
    [
      'a branch name with edge spaces',
      () => withValue(written(), ['branchNames', 0, 'name'], ' Main '),
      'schema.text-malformed',
    ],
    [
      'a fork origin without its node',
      () =>
        withValue(written(), nodeAt(indexOf(0), 'origin'), {
          kind: 'fork',
          project: stranger,
          stateFingerprint: fingerprint(0),
        }),
      'schema.missing-member',
    ],
    [
      'a fork origin without the fingerprint of the state it was taken from',
      () =>
        withValue(written(), nodeAt(indexOf(0), 'origin'), {
          kind: 'fork',
          project: stranger,
          node: stranger,
        }),
      'schema.missing-member',
    ],
    [
      'a fork origin whose source state is not a fingerprint',
      () =>
        withValue(written(), nodeAt(indexOf(0), 'origin'), {
          kind: 'fork',
          project: stranger,
          node: stranger,
          stateFingerprint: 'the latest',
        }),
      'schema.malformed-fingerprint',
    ],
    [
      'a malformed project identifier',
      () => withValue(written(), ['project'], 'Project'),
      'schema.malformed-id',
    ],
    [
      'a malformed affected identifier',
      () => withValue(written(), nodeAt(indexOf(1), 'affects'), { clips: ['Clip one'] }),
      'schema.malformed-id',
    ],
  ])('is refused with %s', (_name, damaged, code) => {
    expect(codesOf(damaged())).toContain(code);
  });

  it('reports where a problem lies', () => {
    const outcome = read(withValue(written(), ['cursor'], stranger));
    expect(outcome).toEqual([['history.unknown-node', 'history.cursor']]);
  });
});

describe('one node as JSON', () => {
  it('reads back on its own, for the journal and the unpacked tree', () => {
    for (const node of randomRecord(3).nodes) {
      const reading = startReading();
      const back = reading.outcome(
        readHistoryNodeRecord(reading, writeHistoryNodeRecord(node), '', 'node'),
      );
      expect(expectSuccess(back)).toEqual(node);
    }
  });

  it('refuses an argument past the longest text, or a number that is not finite', () => {
    const node = fixedRecord().nodes[1];
    if (node?.kind !== 'change') throw new Error('The fixed record’s second node is a change.');
    for (const value of ['x'.repeat(2 ** 24 + 1), Number.POSITIVE_INFINITY]) {
      const reading = startReading();
      const damaged = {
        ...node,
        forward: [{ commandId: 'test.do', arguments: { value } }] as const,
      };
      expect(
        expectFailureCode(
          reading.outcome(
            readHistoryNodeRecord(reading, writeHistoryNodeRecord(damaged), '', 'node'),
          ),
        ),
      ).toBe('schema.unknown-value');
    }
  });
});

describe('a snapshot as JSON (REQ-STOR-194)', () => {
  it('reads back on its own', () => {
    const snapshot = fixedRecord().snapshots[0];
    if (snapshot === undefined) throw new Error('The fixed record has a snapshot.');
    const full: NamedSnapshot = {
      ...snapshot,
      notes: 'Line one.\nLine two.',
      author: 'Sound designer',
    };
    const reading = startReading();
    const back = reading.outcome(
      readSnapshotRecord(reading, writeSnapshotRecord(full), '', 'snapshot'),
    );
    expect(expectSuccess(back)).toEqual(full);
  });
});

describe('a history label', () => {
  it('is trimmed, and refused where empty, too long or holding a control character', () => {
    expect(label('  Loop candidate B ')).toBe('Loop candidate B');
    expect(expectFailureCode(historyLabelFrom('   '))).toBe('history-label.empty');
    expect(expectFailureCode(historyLabelFrom('x'.repeat(1_025)))).toBe('history-label.too-long');
    expect(expectFailureCode(historyLabelFrom('Two\nlines'))).toBe(
      'history-label.control-character',
    );
    expect(label('x'.repeat(1_024))).toHaveLength(1_024);
  });
});

describe('a retention policy as JSON (REQ-STOR-055)', () => {
  function readPolicy(value: JsonValue): RetentionPolicy | readonly string[] {
    const reading = startReading();
    const result = reading.outcome(readRetentionPolicy(reading, value, '', 'retention'));
    return result.ok ? result.value : result.failures.map((problem) => problem.code);
  }

  it.each<RetentionPolicy>([
    { kind: 'unlimited' },
    { kind: 'budget', bytes: 5_000_000_000 },
    { kind: 'rules', rules: [{ kind: 'recent-changes', count: 500 }] },
    {
      kind: 'rules',
      rules: [
        { kind: 'recent-days', days: 30 },
        { kind: 'recent-changes', count: 1 },
      ],
    },
  ])('reads back %j', (policy) => {
    expect(readPolicy(writeRetentionPolicy(policy))).toEqual(policy);
  });

  it.each<[string, JsonValue, string]>([
    ['an unknown kind', { kind: 'forever' }, 'schema.unknown-value'],
    ['a negative budget', { kind: 'budget', bytes: -1 }, 'schema.number-out-of-range'],
    ['no rules', { kind: 'rules', rules: [] }, 'retention.no-rule'],
    [
      'a rule keeping nothing',
      { kind: 'rules', rules: [{ kind: 'recent-changes', count: 0 }] },
      'schema.number-out-of-range',
    ],
    ['a member of another kind', { kind: 'unlimited', bytes: 3 }, 'schema.unknown-member'],
    [
      'a rule with a member of another kind',
      { kind: 'rules', rules: [{ kind: 'recent-days', days: 2, count: 3 }] },
      'schema.unknown-member',
    ],
  ])('refuses %s', (_name, value, code) => {
    expect(readPolicy(value)).toContain(code);
  });
});
