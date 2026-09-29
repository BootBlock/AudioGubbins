import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { StorageTree } from '@audiogubbins/project-format';

import { openProject } from './project-opening.js';
import { summaryOf } from './testing/model-summary.js';
import { OPERATION_KINDS, randomStep } from './testing/random-sessions.js';
import { seededRandom } from './testing/seeded-random.js';
import { contentOf, setName } from './testing/test-commands.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';

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

/** How many times each operation succeeded, over every seed. */
const SUCCEEDED = new Map<number, number>();

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

    const run = { session, random, test, media: contentOf };
    for (let step = 0; step < STEPS; step += 1) {
      const { kind, succeeded } = await randomStep(run, step);
      if (succeeded) SUCCEEDED.set(kind, (SUCCEEDED.get(kind) ?? 0) + 1);
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
      Array.from({ length: OPERATION_KINDS }, (_, index) => index),
    );
  });
});
