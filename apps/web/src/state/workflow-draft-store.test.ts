import { describe, expect, it } from 'vitest';

import { succeed, unsafeBrandId } from '@audiogubbins/domain';
import { workflowWorld } from '@audiogubbins/guided-workflows/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { observable } from './observable.js';
import type { OpenProjectState } from './open-project-store.js';
import { WorkflowDraftStore } from './workflow-draft-store.js';
import { withChosen } from './workflow-drafts.js';

const PROJECT = unsafeBrandId<'ProjectId'>('project-one');

/** A store open on Prepare One-Shot over the workflows' world, and the project it follows. */
function opened() {
  const world = workflowWorld(sampleProject());
  const project = observable<OpenProjectState>({ kind: 'none' });
  const store = new WorkflowDraftStore(project);
  store.open({
    project: PROJECT,
    key: 'prepare-one-shot',
    state: world.state,
    targets: [world.members.door],
    sound: world.members.door,
  });
  return { world, project, store };
}

function openOf(store: WorkflowDraftStore) {
  const shown = store.get();
  if (shown.kind !== 'open') throw new Error('The dialog is not open.');
  return shown;
}

describe('a workflow’s dialog state', () => {
  it('opens with every option at its default, saying where each came from', () => {
    const { store } = opened();
    const { draft } = openOf(store);

    expect(draft.key === 'prepare-one-shot' && draft.fields.fadeInMilliseconds).toEqual({
      value: 2,
      source: { kind: 'workflow' },
    });
  });

  it('says an option the person set was chosen, and keeps no change once applying', () => {
    const { store } = opened();
    const set = (value: number): void => {
      store.edit((draft) =>
        draft.key === 'prepare-one-shot'
          ? { key: draft.key, fields: withChosen(draft.fields, 'fadeInMilliseconds', value) }
          : draft,
      );
    };

    set(5);
    const { draft } = openOf(store);
    expect(draft.key === 'prepare-one-shot' && draft.fields.fadeInMilliseconds).toEqual({
      value: 5,
      source: { kind: 'chosen' },
    });

    expect(store.applying()).toBe(true);
    const applying = store.get();
    set(9);
    expect(store.get()).toBe(applying);
    expect(store.applying()).toBe(false);
  });

  it('goes back to setting up with what was left out where the step did not apply', () => {
    const { store, world } = opened();
    store.leaveOut([world.members.door]);
    store.applying();

    store.settled(undefined);

    expect(openOf(store)).toMatchObject({ step: { kind: 'setting' }, leftOut: [] });
  });

  it('makes a plan again only when an input it was made from changes', () => {
    const { store, world } = opened();
    let made = 0;
    const plan = () => {
      made += 1;
      return succeed({ description: 'Step', invocations: [], items: [] });
    };

    const first = store.planned([world.state, 1], plan);
    expect(store.planned([world.state, 1], plan)).toBe(first);
    store.planned([world.state, 2], plan);

    expect(made).toBe(2);
  });

  it('closes once the project it was opened in is no longer open', () => {
    const { store, project } = opened();

    project.set({ kind: 'opening', project: unsafeBrandId('project-two') });

    expect(store.get()).toEqual({ kind: 'closed' });
  });
});
