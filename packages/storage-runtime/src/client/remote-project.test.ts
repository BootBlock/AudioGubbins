import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import type { History } from '@audiogubbins/history';
import { ExportDestinationKind, ExportStatus } from '@audiogubbins/project-format';
import type { ProjectModel } from '@audiogubbins/storage';

import { projectScene, rename, storedModel } from '../testing/project-scene.js';
import type { RemoteProjectSession } from './remote-project.js';

/** What a history holds, as values a test compares. */
function contentsOf(history: History) {
  return {
    root: history.root,
    cursor: history.cursor,
    nodes: new Map(history.nodes.entries()),
    children: new Map(history.children.entries()),
    preferred: new Map(history.preferred.entries()),
    branchNames: history.branchNames,
    snapshots: history.snapshots,
  };
}

/** What a model holds, as values a test compares. */
function summaryOf(model: ProjectModel) {
  return { ...model, history: contentsOf(model.history) };
}

/** The name the page's copy of the project shows. */
function nameOf(session: RemoteProjectSession): string {
  return session.getSnapshot().model.state.project.displayName;
}

describe('a project open to write in the storage worker, as the page holds it', () => {
  it('shows each change as the worker made and wrote it, once the change settles', async () => {
    const { storage, project, session } = await projectScene();

    for (const name of ['One', 'Two', 'Three']) {
      expect(expectSuccess(await session.run(rename(name))).kind).toBe('applied');
    }

    const { model, save, access } = session.getSnapshot();
    expect(nameOf(session)).toBe('Three');
    expect(save).toEqual({ kind: 'saved' });
    expect(access).toEqual({ kind: 'writable', transferRequests: [] });
    expect(model.history.nodes.size).toBe(4);
    expect(summaryOf(model)).toEqual(summaryOf(await storedModel(storage, project)));
  });

  it('undoes, redoes and moves to any node', async () => {
    const { session } = await projectScene();
    const root = session.getSnapshot().model.history.root;
    expectSuccess(await session.run(rename('One')));
    expectSuccess(await session.run(rename('Two')));

    expectSuccess(await session.undo());
    expect(nameOf(session)).toBe('One');
    expectSuccess(await session.redo());
    expect(nameOf(session)).toBe('Two');
    expectSuccess(await session.goTo(root));
    expect(nameOf(session)).toBe('Forest walk');
    expect(session.getSnapshot().model.history.cursor).toBe(root);
    expect(session.getSnapshot().model.history.nodes.size).toBe(3);
  });

  it('keeps snapshots and branch names, and lets them go', async () => {
    const { storage, project, session } = await projectScene();
    expectSuccess(await session.run(rename('Approved')));
    const node = session.getSnapshot().model.history.cursor;

    expectSuccess(await session.createSnapshot({ name: 'Signed off' }));
    expectSuccess(await session.nameBranch(node, 'Main take'));
    const [snapshot] = session.getSnapshot().model.history.snapshots.values();
    if (snapshot === undefined) throw new Error('No snapshot was kept.');
    expect(snapshot).toMatchObject({ name: 'Signed off', node });
    expect(session.getSnapshot().model.history.branchNames.get(node)).toBe('Main take');
    expect(summaryOf(session.getSnapshot().model)).toEqual(
      summaryOf(await storedModel(storage, project)),
    );

    expectSuccess(await session.deleteSnapshot(snapshot.id));
    expectSuccess(await session.nameBranch(node, undefined));
    expect(session.getSnapshot().model.history.snapshots.size).toBe(0);
    expect(session.getSnapshot().model.history.branchNames.size).toBe(0);
  });

  it('opens a comparison, switches its side, closes it, and promotes a side', async () => {
    const { session } = await projectScene();
    expectSuccess(await session.run(rename('Loop A')));
    const a = session.getSnapshot().model.history.cursor;
    expectSuccess(await session.run(rename('Loop B')));
    const b = session.getSnapshot().model.history.cursor;
    const sides = [
      { kind: 'node', node: a },
      { kind: 'node', node: b },
    ] as const;

    const compared = expectSuccess(await session.compare(...sides));
    expect(compared.difference.project).not.toEqual([]);
    expect(session.getSnapshot().model.comparison).toMatchObject({
      a: { node: a },
      b: { node: b },
      listening: 'a',
    });
    expectSuccess(await session.switchSide());
    expect(session.getSnapshot().model.comparison?.listening).toBe('b');
    expectSuccess(await session.closeComparison());
    expect(session.getSnapshot().model).not.toHaveProperty('comparison');

    expectSuccess(await session.compare(...sides));
    expectSuccess(await session.promote('a'));
    expect(session.getSnapshot().model.history.cursor).toBe(a);
    expect(nameOf(session)).toBe('Loop A');
  });

  it('plans a compaction, and once it is carried out holds no node it removed', async () => {
    const { storage, project, session } = await projectScene();
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      expectSuccess(await session.run(rename(name)));
    }
    const newRoot = session.getSnapshot().model.history.cursor;

    const plan = expectSuccess(await session.planCompaction({ kind: 'before', node: newRoot }));
    expect(plan.removable).toHaveLength(4);
    expectSuccess(await session.compactHistory(plan, plan));

    const { history } = session.getSnapshot().model;
    expect(history.root).toBe(newRoot);
    expect(plan.removable.filter((node) => history.nodes.has(node))).toEqual([]);
    expect([...history.nodes.keys()]).toEqual([newRoot]);
    expect(summaryOf(session.getSnapshot().model)).toEqual(
      summaryOf(await storedModel(storage, project)),
    );
  });

  it('records an export with an identifier and a time the worker gives it', async () => {
    const { session } = await projectScene();
    const { history } = session.getSnapshot().model;
    const stateFingerprint = history.nodes.get(history.cursor)?.stateFingerprint;
    if (stateFingerprint === undefined) throw new Error('The root keeps no state.');

    expectSuccess(
      await session.recordExport({
        stateFingerprint,
        historyNodeId: history.cursor,
        engineVersions: new Map(),
        output: { container: 'wav', settings: new Map() },
        destination: { kind: ExportDestinationKind.Download },
        status: ExportStatus.Succeeded,
        problems: [],
      }),
    );

    const [record] = session.getSnapshot().model.exports;
    expect(record?.id).toEqual(expect.any(String));
    expect(record?.at).toEqual(expect.any(Number));
    expect(record?.historyNodeId).toBe(history.cursor);
  });
});
