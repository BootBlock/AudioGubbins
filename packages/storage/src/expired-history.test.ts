import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { RetentionPolicy } from '@audiogubbins/project-format';

import { planCleanup, type CleanupStep } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import { openProject } from './project-opening.js';
import { storageOf } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import { WINDOW_B, madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * The cleanup step of history each project's retention policy lets go
 * (REQ-STOR-106 step 5, REQ-STOR-055, REQ-STOR-200): planned per project with
 * the capabilities each plan loses, carried out only with the cleanup's
 * confirmation through a session of the project, and passing over a project
 * another window writes.
 */

const KEEP_ONE: RetentionPolicy = { kind: 'rules', rules: [{ kind: 'recent-changes', count: 1 }] };

/** A closed project whose policy keeps one change, with more changes made since it was set. */
async function expiring() {
  const test = harness();
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  expectSuccess(await session.setRetentionPolicy(KEEP_ONE));
  for (const name of ['One', 'Two', 'Three']) expectSuccess(await session.run(setName(name)));
  expectSuccess(await session.close());
  return { test, tree, storage, header };
}

function historyStep(steps: readonly CleanupStep[]) {
  const step = steps.find((each) => each.kind === 'expired-history');
  if (step?.kind !== 'expired-history') throw new Error('No history was planned.');
  return step;
}

describe('compacting expired history in a cleanup', () => {
  it('plans each project’s compaction with what it loses, and carries it out on confirmation', async () => {
    const { test, tree, storage, header } = await expiring();
    const plan = expectSuccess(
      await planCleanup([{ kind: 'expired-history' }], storage.cleaning, test.clock.now()),
    );
    const step = historyStep(plan.steps);
    expect(step.loses).toBe('history');
    const compaction = step.compactions.get(header.id);
    expect(compaction?.lost).toMatchObject([{ kind: 'undo-before' }]);
    expect(plan.confirmationBytes).toBe(step.bytes);

    const outcomes = expectSuccess(
      await runCleanup(plan, { bytes: plan.confirmationBytes }, storage.cleaning),
    );
    expect(outcomes).toEqual([
      { step: 'expired-history', freed: step.bytes, busy: [], unapplied: [] },
    ]);
    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(20).services(tree)),
    );
    const model = reopened.kind === 'read-only' ? reopened.view.getSnapshot().model : undefined;
    expect(model?.history.nodes.size).toBe(2);
    expect(model?.state.project.displayName).toBe('Three');
  });

  it('passes over a project another window writes, changing nothing of it', async () => {
    const { test, tree, storage, header } = await expiring();
    const plan = expectSuccess(
      await planCleanup([{ kind: 'expired-history' }], storage.cleaning, test.clock.now()),
    );
    const other = await openToWrite(test, tree, header.id, { owner: WINDOW_B });
    const outcomes = expectSuccess(
      await runCleanup(plan, { bytes: plan.confirmationBytes }, storage.cleaning),
    );
    expect(outcomes).toEqual([
      { step: 'expired-history', freed: 0, busy: [header.id], unapplied: [] },
    ]);
    expect(other.getSnapshot().model.history.nodes.size).toBe(4);
  });

  it('plans nothing for a project whose policy keeps everything', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const storage = storageOf(test, tree);
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    for (const name of ['One', 'Two', 'Three']) expectSuccess(await session.run(setName(name)));
    expectSuccess(await session.close());
    const plan = expectSuccess(
      await planCleanup([{ kind: 'expired-history' }], storage.cleaning, test.clock.now()),
    );
    expect(plan.steps).toEqual([]);
  });
});
