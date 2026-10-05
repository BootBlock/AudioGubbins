import { describe, expect, it } from 'vitest';

import type { Marker } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { differenceNames } from './difference-names.js';
import { diffStates } from './state-diff.js';
import { fixtureState, processor } from './testing/states.js';

describe('the names of what differs between two states (REQ-STOR-195)', () => {
  it('names each entity from the state that holds it, and a chain for its track', () => {
    const { state, fixture, chain } = fixtureState(sampleProject());
    const { background } = fixture.tracks;
    const { start } = fixture.markers;
    const extra: Marker = {
      id: fixture.ids.next<'MarkerId'>(),
      assetId: start.assetId,
      displayName: 'Scuff',
      basis: start.basis,
      position: start.position,
    };
    const before: ProjectState = {
      ...state,
      project: {
        ...state.project,
        tracks: new Map([
          ...state.project.tracks,
          [background.id, { ...background, effectChainId: chain.id }],
        ]),
      },
    };
    const markers = new Map(before.project.markers);
    markers.delete(start.id);
    markers.set(extra.id, extra);
    const after: ProjectState = {
      ...before,
      project: {
        ...before.project,
        tracks: new Map([
          ...before.project.tracks,
          [background.id, { ...background, displayName: 'Rain bed', effectChainId: chain.id }],
        ]),
        markers,
        effectChains: new Map([[chain.id, { ...chain, slots: [processor(fixture, 'reverb')] }]]),
      },
    };

    const names = differenceNames(before, after, diffStates(before, after));
    expect(names.entities).toEqual(
      new Map<string, string>([
        [background.id, 'Rain bed'],
        [start.id, start.displayName],
        [extra.id, 'Scuff'],
      ]),
    );
    expect(names.chains).toEqual(new Map([[chain.id, { kind: 'track', name: 'Rain bed' }]]));
  });

  it('names nothing where nothing differs', () => {
    const { state } = fixtureState(sampleProject());
    const names = differenceNames(state, state, diffStates(state, state));
    expect(names.entities.size + names.chains.size).toBe(0);
  });
});
