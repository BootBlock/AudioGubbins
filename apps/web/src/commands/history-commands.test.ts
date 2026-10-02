import { describe, expect, it } from 'vitest';

import type { HistoryNode } from '@audiogubbins/history';
import type { ProjectModel } from '@audiogubbins/storage';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';

/** The open project's model, which every test here has. */
function modelOf(window: ProjectWindow): ProjectModel {
  const open = window.projects.project.get();
  if (open.kind !== 'open') throw new Error('No project is open.');
  return open.snapshot.model;
}

/** The change described as `description`, which the test made. */
function changeCalled(window: ProjectWindow, description: string): HistoryNode {
  const found = [...modelOf(window).history.nodes.values()].find(
    (node) => node.kind === 'change' && node.description.includes(description),
  );
  if (found === undefined) throw new Error(`No change ${description}.`);
  return found;
}

/**
 * A project made as A, renamed B and then C, undone once and renamed D, so its
 * history has a branch: after B, C on one side and D, where it is, on the
 * other.
 */
async function branched(): Promise<ProjectWindow> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'A' });
  await window.runAndHear('file.rename-project', { name: 'B' });
  await window.runAndHear('file.rename-project', { name: 'C' });
  await window.runAndHear('edit.undo');
  await window.runAndHear('file.rename-project', { name: 'D' });
  return window;
}

describe('undo and redo', () => {
  it('undoes and redoes a change, saying which, and refuses where there is none', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'A' });
    expect(window.run('edit.undo')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'There is nothing to undo.' }],
    });
    await window.runAndHear('file.rename-project', { name: 'B' });

    expect(await window.runAndHear('edit.undo')).toMatch(/^Undone: Rename .*\.$/);
    expect(modelOf(window).state.project.displayName).toBe('A');
    expect(await window.runAndHear('edit.redo')).toMatch(/^Redone: Rename .*\.$/);
    expect(modelOf(window).state.project.displayName).toBe('B');
    expect(window.run('edit.redo').kind).toBe('refused');
  });

  it('is unavailable where no project is open to change', async () => {
    const window = await projectWorld().window();

    expect(window.run('edit.undo')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'No project is open.' }],
    });
  });
});

describe('points of the history', () => {
  it('goes to a point on another branch, which the undo stack alone could not reach', async () => {
    const window = await branched();
    const c = changeCalled(window, '“C”');

    expect(await window.runAndHear('history.go-to', { node: c.id })).toMatch(
      /^The project is after Rename/,
    );
    expect(modelOf(window).state.project.displayName).toBe('C');
    expect(window.run('history.go-to', { node: 'nowhere' }).kind).toBe('refused');
  });

  it('keeps a named snapshot of the current state, and deletes it', async () => {
    const window = await branched();

    expect(
      await window.runAndHear('history.snapshot', { name: 'Before the mix', notes: 'Rough' }),
    ).toBe('The snapshot "Before the mix" is kept.');
    const [snapshot] = modelOf(window).history.snapshots.values();
    expect(snapshot).toMatchObject({ name: 'Before the mix', notes: 'Rough' });

    expect(
      await window.runAndHear('history.delete-snapshot', { snapshot: snapshot?.id ?? '' }),
    ).toBe('The snapshot is deleted.');
    expect(modelOf(window).history.snapshots.size).toBe(0);
    expect(window.run('history.snapshot', { name: '  ' }).kind).toBe('refused');
  });

  it('names the branch a point starts, and takes the name away', async () => {
    const window = await branched();
    const d = changeCalled(window, '“D”');

    expect(
      await window.runAndHear('history.name-branch', { node: d.id, name: 'The other take' }),
    ).toBe('The branch is called "The other take".');
    expect(modelOf(window).history.branchNames.get(d.id)).toBe('The other take');
    expect(await window.runAndHear('history.name-branch', { node: d.id })).toBe(
      'The branch has no name now.',
    );
    expect(modelOf(window).history.branchNames.has(d.id)).toBe(false);
  });
});

describe('the A/B comparison', () => {
  it('compares a point with the current state, switches sides, keeps one, and stops', async () => {
    const window = await branched();
    const c = changeCalled(window, '“C”');

    expect(await window.runAndHear('history.compare', { node: c.id })).toBe(
      'Comparing. Side A is the current state, and it is the one being heard.',
    );
    expect(modelOf(window).comparison?.listening).toBe('a');
    expect(window.projects.review.get().difference?.difference.project).toEqual(['displayName']);

    expect(await window.runAndHear('history.switch-side')).toBe('Side B is heard.');
    expect(await window.runAndHear('history.switch-side', { side: 'a' })).toBe('Side A is heard.');
    expect(window.run('history.switch-side', { side: 'c' }).kind).toBe('refused');

    expect(await window.runAndHear('history.promote', { side: 'b' })).toBe(
      'Side B is the current state. The other stays in the history.',
    );
    expect(modelOf(window).state.project.displayName).toBe('C');

    expect(await window.runAndHear('history.close-comparison')).toBe('The comparison is closed.');
    expect(modelOf(window).comparison).toBeUndefined();
    expect(window.run('history.close-comparison').kind).toBe('refused');
  });
});

describe('choosing both sides of a comparison', () => {
  it('compares a point or a snapshot chosen first with another, side A first', async () => {
    const window = await branched();
    const c = changeCalled(window, '“C”');
    const d = changeCalled(window, '“D”');

    expect(await window.runAndHear('history.choose-side', { node: c.id })).toBe(
      'Chosen as side A. Choose another state to compare it with.',
    );
    expect(window.projects.review.get().chosen).toEqual({ kind: 'node', node: c.id });
    expect(await window.runAndHear('history.compare', { node: d.id, fromNode: c.id })).toBe(
      'Comparing. Side A is the one chosen first, and it is the one being heard.',
    );
    expect(modelOf(window).comparison).toMatchObject({ a: { node: c.id }, b: { node: d.id } });
    expect(window.projects.review.get().chosen).toBeUndefined();

    await window.runAndHear('history.snapshot', { name: 'Kept' });
    const [snapshot] = modelOf(window).history.snapshots.keys();
    if (snapshot === undefined) throw new Error('No snapshot was kept.');
    await window.runAndHear('history.compare', { snapshot, fromNode: c.id });
    expect(modelOf(window).comparison).toMatchObject({
      a: { node: c.id },
      b: { snapshot, name: 'Kept' },
    });
    expect(window.run('history.compare', { fromNode: c.id }).kind).toBe('refused');
  });

  it('works out again what differs between the sides kept, once the project opens again', async () => {
    const window = await branched();
    const c = changeCalled(window, '“C”');
    await window.runAndHear('history.compare', { node: c.id });
    const project = window.projects.project.session()?.project ?? '';
    await window.runAndHear('file.close-project');
    expect(window.projects.review.get().difference).toBeUndefined();

    await window.runAndHear('file.open', { project });
    await expect
      .poll(() => window.projects.review.get().difference?.difference.project)
      .toEqual(['displayName']);
    expect(window.projects.review.get().difference).toMatchObject({
      a: modelOf(window).history.cursor,
      b: c.id,
    });
  });
});

describe('letting history go', () => {
  it('plans removing the history before a point, removes nothing until confirmed, then removes it', async () => {
    const window = await branched();
    const d = changeCalled(window, '“D”');
    const before = modelOf(window).history.nodes.size;

    expect(await window.runAndHear('history.plan-compaction', { before: d.id })).toMatch(
      /^The plan would remove \d+ points? of the history and free .+\. Review it before you confirm it\.$/,
    );
    const pending = window.projects.review.get().compaction;
    expect(pending?.plan.removable.length).toBeGreaterThan(0);
    expect(modelOf(window).history.nodes.size).toBe(before);

    expect(await window.runAndHear('history.confirm-compaction')).toMatch(
      /^The history is compacted, freeing .+\.$/,
    );
    expect(modelOf(window).history.nodes.size).toBeLessThan(before);
    expect(window.projects.review.get().compaction).toBeUndefined();
    expect(window.run('history.confirm-compaction').kind).toBe('refused');
  });

  it('plans removing a branch the project is not on, and puts the plan away, keeping it', async () => {
    const window = await branched();
    const c = changeCalled(window, '“C”');
    expect(await window.runAndHear('history.plan-compaction', { branch: c.id })).toMatch(
      /^The plan would remove 1 point of the history/,
    );

    window.run('history.cancel-compaction');
    expect(window.said.at(-1)).toBe('Nothing was removed from the history.');
    expect(window.projects.review.get().compaction).toBeUndefined();
  });

  it('plans a retention policy, shows what it frees, and sets it once confirmed', async () => {
    const window = await branched();
    const before = modelOf(window).history.nodes.size;

    await window.runAndHear('history.plan-retention', { kind: 'recent-changes', value: 1 });
    const pending = window.projects.review.get().compaction;
    expect(pending?.policy).toEqual({
      kind: 'rules',
      rules: [{ kind: 'recent-changes', count: 1 }],
    });
    expect(modelOf(window).retention).toEqual({ kind: 'unlimited' });

    expect(await window.runAndHear('history.confirm-compaction')).toBe(
      'The project keeps its history as you chose.',
    );
    expect(modelOf(window).retention).toEqual(pending?.policy);
    expect(modelOf(window).history.nodes.size).toBeLessThan(before);
  });

  it('refuses a retention policy it cannot read', async () => {
    const window = await branched();

    expect(window.run('history.plan-retention', { kind: 'recent-days', value: 0 }).kind).toBe(
      'refused',
    );
    expect(window.run('history.plan-retention', { kind: 'forever', value: 3 }).kind).toBe(
      'refused',
    );
    expect(await window.runAndHear('history.plan-retention', { kind: 'unlimited' })).toBe(
      'Nothing in the history would be removed.',
    );
  });
});
