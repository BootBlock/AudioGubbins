/**
 * Seeded random sessions: each step one operation of an open project, chosen by
 * weight, over changes, undo, redo, moves across branches, branch names,
 * snapshots, A/B comparisons of nodes and of snapshots, exports, policies and
 * checkpoints, for the round-trip tests of everything that keeps or carries a
 * project.
 */

import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  ExportDestinationKind,
  ExportStatus,
  stateFingerprintFrom,
  type ContentId,
} from '@audiogubbins/project-format';

import type { ProjectSession } from '../project-session.js';
import type { Random } from './seeded-random.js';
import type { Harness } from './storage-harness.js';
import { addAsset, setName } from './test-commands.js';

/** A random session: the project, the numbers, the harness and the media added. */
export interface SessionRun {
  readonly session: ProjectSession;
  readonly random: Random;
  readonly test: Harness;

  /** The content of an asset added, by a small number. */
  readonly media: (index: number) => ContentId;
}

type Operation = (run: SessionRun, step: number) => Promise<unknown>;

const OPERATIONS: readonly (readonly [weight: number, Operation])[] = [
  [30, async ({ session }, step) => await session.run(setName(`Step ${String(step)}`))],
  [
    8,
    async ({ session, random, test, media }) =>
      await session.run(addAsset(test.ids.next<'AssetId'>(), media(random.below(5)))),
  ],
  [
    4,
    async ({ session, test, media }, step) =>
      await session.runGroup(`Group ${String(step)}`, [
        setName(`Grouped ${String(step)}`),
        addAsset(test.ids.next<'AssetId'>(), media(9)),
      ]),
  ],
  [12, async ({ session }) => await session.undo()],
  [8, async ({ session }) => await session.redo()],
  [10, async ({ session, random }) => await session.goTo(randomNode(session, random))],
  [
    5,
    async ({ session, random }, step) =>
      await session.nameBranch(
        randomNode(session, random),
        random.next() < 0.8 ? `Branch ${String(step)}` : undefined,
      ),
  ],
  [
    5,
    async ({ session }, step) =>
      await session.createSnapshot({ name: `Snapshot ${String(step)}`, notes: 'Notes' }),
  ],
  [
    2,
    async ({ session, random }) => {
      // Half the time the snapshot a side of the open comparison was chosen by,
      // which closes the comparison.
      const compared = session.getSnapshot().model.comparison?.a.snapshot;
      const snapshot =
        compared !== undefined && random.next() < 0.5 ? compared : randomSnapshot(session, random);
      return snapshot === undefined ? undefined : await session.deleteSnapshot(snapshot);
    },
  ],
  [
    4,
    async ({ session, random }) =>
      await session.compare(
        { kind: 'node', node: randomNode(session, random) },
        { kind: 'node', node: randomNode(session, random) },
      ),
  ],
  [
    4,
    async ({ session, random }) => {
      const snapshot = randomSnapshot(session, random);
      if (snapshot === undefined) return undefined;
      const other = randomSnapshot(session, random);
      return await session.compare(
        { kind: 'snapshot', snapshot },
        other !== undefined && random.next() < 0.5
          ? { kind: 'snapshot', snapshot: other }
          : { kind: 'node', node: randomNode(session, random) },
      );
    },
  ],
  [3, async ({ session }) => await session.switchSide()],
  [1, async ({ session }) => await session.closeComparison()],
  [
    3,
    async ({ session, test }) =>
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
    async ({ session, random }) =>
      await session.setRetentionPolicy({
        kind: 'rules',
        rules: [{ kind: 'recent-changes', count: 1 + random.below(50) }],
      }),
  ],
  [
    1,
    async ({ session, random }) =>
      await session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 + random.below(20) },
        retention: { days: 7 },
      }),
  ],
  [3, async ({ session }) => await session.checkpoint()],
];

/** How many kinds of operation a random step chooses from. */
export const OPERATION_KINDS = OPERATIONS.length;

function randomNode(session: ProjectSession, random: Random) {
  const nodes = [...session.getSnapshot().model.history.nodes.keys()];
  const node = random.pick(nodes);
  if (node === undefined) throw new Error('A history has a node.');
  return node;
}

function randomSnapshot(session: ProjectSession, random: Random) {
  return random.pick([...session.getSnapshot().model.history.snapshots.keys()]);
}

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

/** Runs one random operation, and says which it was and whether it succeeded. */
export async function randomStep(
  run: SessionRun,
  step: number,
): Promise<{ readonly kind: number; readonly succeeded: boolean }> {
  const [kind, operation] = chosen(run.random);
  return { kind, succeeded: succeeded(await operation(run, step)) };
}
