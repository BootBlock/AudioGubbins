import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { activeLine } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { HistoryNodeId, RetentionPolicy } from '@audiogubbins/project-format';

import { openProject } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { summaryOf } from './testing/model-summary.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * Compacting an open project's history (REQ-STOR-055, REQ-STOR-200): planned
 * first with what it loses, carried out only with a confirmation of that plan,
 * keeping the new root's state whole so the project is still reached from it,
 * and surviving a reload; and a retention policy that would let history go set
 * only with the person's confirmation of what it lets go.
 */

const KEEP_ONE: RetentionPolicy = { kind: 'rules', rules: [{ kind: 'recent-changes', count: 1 }] };

async function fourChanges() {
  const test = harness();
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  for (const name of ['One', 'Two', 'Three', 'Four'])
    expectSuccess(await session.run(setName(name)));
  return { test, tree, header, session };
}

function lineOf(session: ProjectSession): readonly HistoryNodeId[] {
  const { history } = session.getSnapshot().model;
  return activeLine(history).map((node) => node.id);
}

describe('compacting a history the person confirmed', () => {
  it('moves the root, keeps its state whole, and survives a reload', async () => {
    const { tree, header, session } = await fourChanges();
    const line = lineOf(session);
    const newRoot = line[2];
    if (newRoot === undefined) throw new Error('No third node.');

    const plan = expectSuccess(await session.planCompaction({ kind: 'before', node: newRoot }));
    expect(plan.newRoot).toBe(newRoot);
    expect(plan.lost).toMatchObject([{ kind: 'undo-before', root: newRoot, changes: 2 }]);
    expect(expectSuccess(await session.compactHistory(plan, plan))).toEqual({ kind: 'written' });

    const { model } = session.getSnapshot();
    expect(model.history.root).toBe(newRoot);
    expect(model.history.nodes.get(newRoot)?.stateFingerprint).toBeDefined();
    expect(model.state.project.displayName).toBe('Four');

    // Undoing reaches the new root's state, and no further.
    expectSuccess(await session.undo());
    expectSuccess(await session.undo());
    expect(session.getSnapshot().model.state.project.displayName).toBe('Two');
    expect(expectFailureCode(await session.undo())).toBe('history.nothing-to-undo');

    const summary = summaryOf(session.getSnapshot().model);
    expectSuccess(await session.close());
    const reopened = await openToWrite(harness(30), tree, header.id);
    expect(summaryOf(reopened.getSnapshot().model)).toBe(summary);
  });

  it('refuses a confirmation of another plan, changing nothing', async () => {
    const { session } = await fourChanges();
    const before = summaryOf(session.getSnapshot().model);
    const node = lineOf(session)[2];
    if (node === undefined) throw new Error('No third node.');
    const plan = expectSuccess(await session.planCompaction({ kind: 'before', node }));
    expect(
      expectFailureCode(
        await session.compactHistory(plan, { reclaimableBytes: plan.reclaimableBytes + 1 }),
      ),
    ).toBe('storage.compaction-unconfirmed');
    expect(summaryOf(session.getSnapshot().model)).toBe(before);
  });

  it('keeps the states an open comparison stands on', async () => {
    const { session } = await fourChanges();
    const line = lineOf(session);
    const [root, first] = line;
    if (root === undefined || first === undefined) throw new Error('No nodes.');
    const last = line.at(-1);
    if (last === undefined) throw new Error('No last node.');
    expectSuccess(
      await session.compare({ kind: 'node', node: first }, { kind: 'node', node: last }),
    );
    const after = line[3];
    if (after === undefined) throw new Error('No fourth node.');
    expect(expectFailureCode(await session.planCompaction({ kind: 'before', node: after }))).toBe(
      'compaction.history-needed',
    );
  });
});

describe('a retention policy that would let history go', () => {
  it('is set only with a confirmation of what it lets go, which is then carried out', async () => {
    const { tree, header, session } = await fourChanges();
    const before = summaryOf(session.getSnapshot().model);
    expect(expectFailureCode(await session.setRetentionPolicy(KEEP_ONE))).toBe(
      'storage.retention-unconfirmed',
    );
    expect(summaryOf(session.getSnapshot().model)).toBe(before);

    const plan = expectSuccess(await session.planCompaction({ kind: 'policy', policy: KEEP_ONE }));
    expect(plan.removable.length).toBeGreaterThan(0);
    expect(expectSuccess(await session.setRetentionPolicy(KEEP_ONE, plan))).toEqual({
      kind: 'written',
    });
    const { model } = session.getSnapshot();
    expect(model.retention).toEqual(KEEP_ONE);
    expect(model.history.nodes.size).toBe(2);

    expectSuccess(await session.close());
    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(31).services(tree)),
    );
    const view = reopened.kind === 'read-only' ? reopened.view.getSnapshot().model : undefined;
    expect(view?.retention).toEqual(KEEP_ONE);
    expect(view?.history.nodes.size).toBe(2);
  });

  it('is set at once where it lets nothing go', async () => {
    const { session } = await fourChanges();
    expectSuccess(await session.setRetentionPolicy({ kind: 'budget', bytes: 1_000_000_000 }));
    expect(session.getSnapshot().model.retention).toEqual({ kind: 'budget', bytes: 1_000_000_000 });
    expect(session.getSnapshot().model.history.nodes.size).toBe(5);
  });
});

describe('a retention policy once set', () => {
  /** A new project open with a checkpoint every two changes, keeping the last change. */
  async function keepingOne() {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const cadence = { checkpointAfter: 2, keepStateEvery: 64 };
    const session = await openToWrite(test, tree, header.id, { cadence });
    expectSuccess(await session.setRetentionPolicy(KEEP_ONE));
    return { test, tree, header, session };
  }

  it('goes on letting go what it lets go at each checkpoint, which a reload keeps', async () => {
    const { tree, header, session } = await keepingOne();
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      expectSuccess(await session.run(setName(name)));
    }
    // Anything the session does waits for the retention queued before it.
    expectSuccess(await session.checkpoint());

    const { model } = session.getSnapshot();
    expect(model.history.nodes.size).toBeLessThanOrEqual(3);
    expect(model.state.project.displayName).toBe('Six');
    expectSuccess(await session.undo());
    expect(session.getSnapshot().model.state.project.displayName).toBe('Five');
    expectSuccess(await session.close());

    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(31).services(tree)),
    );
    const view = reopened.kind === 'read-only' ? reopened.view.getSnapshot().model : undefined;
    expect(view?.history.nodes.size).toBe(session.getSnapshot().model.history.nodes.size);
  });

  it('never lets a snapshot go, nor the history it stands on', async () => {
    const { session } = await keepingOne();
    expectSuccess(await session.run(setName('One')));
    expectSuccess(await session.createSnapshot({ name: 'Kept' }));
    const kept = session.getSnapshot().model.history.cursor;
    for (const name of ['Two', 'Three', 'Four', 'Five']) {
      expectSuccess(await session.run(setName(name)));
    }
    expectSuccess(await session.checkpoint());

    const { history } = session.getSnapshot().model;
    expect(history.snapshots.size).toBe(1);
    expect(history.nodes.has(kept)).toBe(true);
    expect(activeLine(history).map((node) => node.id)).toContain(kept);
  });
});
