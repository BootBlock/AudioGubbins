import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { RetentionPolicy } from '@audiogubbins/project-format';
import { countedTurns, type CountedTurns } from '@audiogubbins/project-format/testing';

import { openProject } from './project-opening.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';
import { WatchedTree } from './testing/watched-tree.js';

/**
 * The work an open project does over its whole history (ADR-0022): opening it,
 * planning the segments of a checkpoint, and planning a compaction. Each looks
 * at every node in memory, where no read gives the storage worker a turn, so
 * each takes its turns through the host's port; and an opening the page gives
 * up stops where its signal aborts, whichever way the project opens.
 */

/** Changes enough that a pass over the history takes several turns. */
const CHANGES = 300;

const KEEP_ONE: RetentionPolicy = { kind: 'rules', rules: [{ kind: 'recent-changes', count: 1 }] };

/** A project of {@link CHANGES} changes, open to write, whose work asks `turns` for its turns. */
async function longProject(turns: CountedTurns) {
  const test = harness(91);
  const tree = new WatchedTree(new MemoryStorageTree());
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id, {
    yieldToHost: turns.yieldToHost,
    cadence: { checkpointAfter: 1_000, keepStateEvery: 1_000 },
  });
  for (let change = 0; change < CHANGES; change += 1) {
    expectSuccess(await session.run(setName(`Name ${String(change)}`)));
  }
  return { test, tree, header, session };
}

describe('the turns a project takes over its history', () => {
  it('asks the host for turns as a checkpoint plans the segments of a long history', async () => {
    const turns = countedTurns();
    const { session } = await longProject(turns);
    const before = turns.asked;

    expectSuccess(await session.checkpoint());

    // Every node placed, and every new one measured: two steps for each.
    expect(turns.asked - before).toBeGreaterThanOrEqual(4);
  });

  it('asks the host for turns as it plans a compaction, and stops at the turn its signal aborts in', async () => {
    const controller = new AbortController();
    const reason = new Error('Replaced by a newer one.');
    let armed = false;
    const turns = countedTurns(() => {
      if (armed) controller.abort(reason);
    });
    const { session } = await longProject(turns);
    expectSuccess(await session.planCompaction({ kind: 'policy', policy: KEEP_ONE }));
    armed = true;

    const planning = session.planCompaction(
      { kind: 'policy', policy: KEEP_ONE },
      controller.signal,
    );

    await expect(planning).rejects.toBe(reason);
  });
});

describe('an opening given up', () => {
  it('stops reading the journal of a project it opens to read', async () => {
    const turns = countedTurns();
    const { test, tree, header } = await longProject(turns);
    const controller = new AbortController();
    const reason = new Error('Replaced by a newer one.');
    tree.actAt(
      'read',
      (path) => path.includes('/journal/'),
      () => {
        controller.abort(reason);
      },
    );

    const opening = openProject(
      { project: header.id, access: 'read', signal: controller.signal },
      test.services(tree),
    );

    await expect(opening).rejects.toBe(reason);
    expect(tree.operationsSince).toBe(0);
  });
});
