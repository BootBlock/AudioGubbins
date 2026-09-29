import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  ExportDestinationKind,
  ExportStatus,
  stateFingerprintFrom,
  type StorageTree,
} from '@audiogubbins/project-format';

import { openProject } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { summaryOf } from './testing/model-summary.js';
import { seededRandom, type Random } from './testing/seeded-random.js';
import { addAsset, contentOf, setName } from './testing/test-commands.js';
import { harness, madeProject, openToWrite, type Harness } from './testing/storage-harness.js';

/**
 * Randomised round trips (the packet's acceptance criteria): seeded sessions of
 * changes, undo, redo, moves across branches, branch names, snapshots, A/B
 * comparisons, exports, policies and checkpoints, after which the project is
 * opened again from storage, both while the session is still open and once it
 * has closed. The state, the whole history with its cursor, redo line, branch
 * names and snapshots, the export log, the policies and the open comparison
 * must all come back as they were.
 */

const SEEDS = Array.from({ length: 24 }, (_, index) => index + 1);
const STEPS = 60;

type Operation = (
  session: ProjectSession,
  random: Random,
  test: Harness,
  step: number,
) => Promise<unknown>;

const OPERATIONS: readonly (readonly [weight: number, Operation])[] = [
  [30, async (session, _, __, step) => await session.run(setName(`Step ${String(step)}`))],
  [
    8,
    async (session, random, test) =>
      await session.run(addAsset(test.ids.next<'AssetId'>(), contentOf(random.below(5)))),
  ],
  [
    4,
    async (session, _, test, step) =>
      await session.runGroup(`Group ${String(step)}`, [
        setName(`Grouped ${String(step)}`),
        addAsset(test.ids.next<'AssetId'>(), contentOf(9)),
      ]),
  ],
  [12, async (session) => await session.undo()],
  [8, async (session) => await session.redo()],
  [10, async (session, random) => await session.goTo(randomNode(session, random))],
  [
    5,
    async (session, random, _, step) =>
      await session.nameBranch(
        randomNode(session, random),
        random.next() < 0.8 ? `Branch ${String(step)}` : undefined,
      ),
  ],
  [
    5,
    async (session, _, __, step) =>
      await session.createSnapshot({ name: `Snapshot ${String(step)}`, notes: 'Notes' }),
  ],
  [
    2,
    async (session, random) => {
      const snapshot = random.pick([...session.getSnapshot().model.history.snapshots.keys()]);
      return snapshot === undefined ? undefined : await session.deleteSnapshot(snapshot);
    },
  ],
  [
    4,
    async (session, random) =>
      await session.compare(
        { kind: 'node', node: randomNode(session, random) },
        { kind: 'node', node: randomNode(session, random) },
      ),
  ],
  [3, async (session) => await session.switchSide()],
  [1, async (session) => await session.closeComparison()],
  [
    3,
    async (session, _, test) =>
      await session.recordExport({
        id: test.ids.next<'ExportRecordId'>(),
        at: test.clock.now(),
        stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'0'.repeat(64)}`)),
        engineVersions: new Map([['engine', '1']]),
        output: { container: 'wav', settings: new Map([['bits', 24]]) },
        destination: { kind: ExportDestinationKind.Download },
        status: ExportStatus.Succeeded,
        problems: [],
      }),
  ],
  [
    1,
    async (session, random) =>
      await session.setRetentionPolicy({
        kind: 'rules',
        rules: [{ kind: 'recent-changes', count: 1 + random.below(50) }],
      }),
  ],
  [
    1,
    async (session, random) =>
      await session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 + random.below(20) },
        retention: { days: 7 },
      }),
  ],
  [3, async (session) => await session.checkpoint()],
];

function randomNode(session: ProjectSession, random: Random) {
  const nodes = [...session.getSnapshot().model.history.nodes.keys()];
  const node = random.pick(nodes);
  if (node === undefined) throw new Error('A history has a node.');
  return node;
}

/** How many times each operation succeeded, over every seed. */
const SUCCEEDED = new Map<number, number>();

function chosen(random: Random): readonly [number, Operation] {
  const total = OPERATIONS.reduce((sum, [weight]) => sum + weight, 0);
  let roll = random.below(total);
  for (const [index, [weight, operation]] of OPERATIONS.entries()) {
    if (roll < weight) return [index, operation];
    roll -= weight;
  }
  throw new Error('A roll fell past every operation.');
}

function succeeded(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'ok' in result && result.ok === true;
}

async function readBack(
  tree: StorageTree,
  project: Parameters<typeof openProject>[0]['project'],
  seed: number,
) {
  const opened = expectSuccess(
    await openProject({ project, access: 'read' }, harness(seed).services(tree)),
  );
  if (opened.kind !== 'read-only') throw new Error('Expected the project to open read-only.');
  expect(opened.report.journalBreak).toBeUndefined();
  expect(opened.report.missingStates).toEqual([]);
  return summaryOf(opened.view.getSnapshot().model);
}

describe('project round trips (randomised, seeded)', () => {
  it.each(SEEDS)('seed %i: everything the session did comes back', async (seed) => {
    const test = harness(seed);
    const random = seededRandom(seed);
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id, {
      cadence: { checkpointAfter: 3 + random.below(12), keepStateEvery: 2 + random.below(6) },
    });

    for (let step = 0; step < STEPS; step += 1) {
      const [index, operation] = chosen(random);
      if (succeeded(await operation(session, random, test, step))) {
        SUCCEEDED.set(index, (SUCCEEDED.get(index) ?? 0) + 1);
      }
      expect(session.getSnapshot().save.kind).toBe('saved');
    }
    const live = summaryOf(session.getSnapshot().model);
    expect(await readBack(tree, header.id, seed + 1_000)).toBe(live);

    expectSuccess(await session.close());
    expect(await readBack(tree, header.id, seed + 2_000)).toBe(live);

    // And again after a further session, which checkpoints over the first.
    const next = await openToWrite(test, tree, header.id);
    expect(summaryOf(next.getSnapshot().model)).toBe(live);
    expectSuccess(await next.run(setName('Onwards')));
    const onwards = summaryOf(next.getSnapshot().model);
    expectSuccess(await next.close());
    expect(await readBack(tree, header.id, seed + 3_000)).toBe(onwards);
  });

  it('exercised every kind of operation, each succeeding at least once', () => {
    expect([...SUCCEEDED.keys()].sort((left, right) => left - right)).toEqual(
      OPERATIONS.map((_, index) => index),
    );
  });
});
