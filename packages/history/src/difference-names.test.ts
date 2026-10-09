import { describe, expect, it } from 'vitest';

import { derivedSampleCount, type Marker } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { chainOwner, differenceNames } from './difference-names.js';
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
    expect(names.chains).toEqual(
      new Map([[chain.id, { kind: 'track', naming: 'whole', name: 'Rain bed' }]]),
    );
  });

  it('names a chain for the asset or region whose rack it is, or a range of which it processes', () => {
    const { state, fixture, chain } = fixtureState(sampleProject());
    const { footstep } = fixture.assets;
    const { loop } = fixture.regions;
    const range = { start: derivedSampleCount(0), end: derivedSampleCount(100) };
    const ranged: ProjectState = {
      ...state,
      project: {
        ...state.project,
        regions: new Map([
          ...state.project.regions,
          [
            loop.id,
            {
              ...loop,
              operations: [
                {
                  id: fixture.ids.next<'EditOperationId'>(),
                  basis: 0,
                  range,
                  edit: { kind: 'rack', chain: chain.id },
                },
              ],
            },
          ],
        ]),
      },
    };
    expect(chainOwner(ranged.project, chain.id)).toEqual({
      kind: 'region',
      naming: 'range',
      name: loop.displayName,
    });
    const racked: ProjectState = {
      ...ranged,
      project: {
        ...ranged.project,
        assets: new Map([...ranged.project.assets, [footstep.id, { ...footstep, rack: chain.id }]]),
      },
    };
    expect(chainOwner(racked.project, chain.id)).toEqual({
      kind: 'asset',
      naming: 'whole',
      name: footstep.displayName,
    });
    // A rack taken away with its chain is named from the state that held it.
    const unracked: ProjectState = {
      ...state,
      project: { ...state.project, effectChains: new Map() },
    };
    const names = differenceNames(racked, unracked, diffStates(racked, unracked));
    expect(names.chains.get(chain.id)).toEqual({
      kind: 'asset',
      naming: 'whole',
      name: footstep.displayName,
    });
  });

  it('names nothing where nothing differs', () => {
    const { state } = fixtureState(sampleProject());
    const names = differenceNames(state, state, diffStates(state, state));
    expect(names.entities.size + names.chains.size).toBe(0);
  });
});
