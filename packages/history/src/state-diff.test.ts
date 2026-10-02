import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  unsafeBrandId,
  type EditOperation,
  type EffectChain,
  type Marker,
  type ParameterId,
  type Region,
  type RegionOperation,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { affectedBy } from './affected-entities.js';
import { unmovedPositions } from './order-changes.js';
import { diffStates } from './state-diff.js';
import { contentOf, fixtureState, processor } from './testing/states.js';

function withChain(state: ProjectState, chain: EffectChain): ProjectState {
  return {
    ...state,
    project: {
      ...state.project,
      effectChains: new Map([...state.project.effectChains, [chain.id, chain]]),
    },
  };
}

describe('the difference of two states (REQ-STOR-195)', () => {
  it('is empty between a state and itself, and between equal states built apart', () => {
    const { state } = fixtureState(sampleProject());
    const empty = {
      added: [],
      removed: [],
      changed: [],
    };
    const expected = {
      project: [],
      assets: empty,
      sources: empty,
      tracks: empty,
      buses: empty,
      clips: empty,
      regions: empty,
      markers: empty,
      effectChains: [],
    };
    expect(diffStates(state, state)).toEqual(expected);
    expect(diffStates(state, fixtureState(sampleProject()).state)).toEqual(expected);
  });

  it('names the project fields that changed', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const after: ProjectState = {
      ...state,
      project: {
        ...state.project,
        displayName: 'Footsteps, final',
        settings: { ...state.project.settings, channelLayout: StandardLayouts.mono },
        trackOrder: [fixture.tracks.background.id, fixture.tracks.foley.id],
      },
    };
    expect(diffStates(state, after).project).toEqual([
      'displayName',
      'channelLayout',
      'trackOrder',
    ]);
  });

  it('lists entities added, removed and changed, each sorted, with the fields that changed', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const { firstStep, secondStep } = fixture.clips;
    const extra: Marker = {
      id: fixture.ids.next<'MarkerId'>(),
      assetId: fixture.markers.start.assetId,
      displayName: 'Scuff',
      basis: fixture.markers.start.basis,
      position: fixture.markers.start.position,
    };
    const after: ProjectState = {
      ...state,
      project: {
        ...state.project,
        clips: new Map([
          [
            firstStep.id,
            {
              ...firstStep,
              gain: 0.5,
              source: { ...firstStep.source, length: firstStep.source.length },
            },
          ],
        ]),
        markers: new Map([...state.project.markers, [extra.id, extra]]),
      },
    };
    const difference = diffStates(state, after);
    expect(difference.clips).toEqual({
      added: [],
      removed: [secondStep.id],
      changed: [{ id: firstStep.id, fields: ['gain'] }],
    });
    expect(difference.markers).toEqual({ added: [extra.id], removed: [], changed: [] });
  });

  it('compares nested values by what they hold: a region’s loop and tags, a clip’s source range', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const { loop } = fixture.regions;
    const { firstStep } = fixture.clips;
    const current = loop.loop;
    if (current === undefined) throw new Error('The fixture region loops.');
    const after: ProjectState = {
      ...state,
      project: {
        ...state.project,
        regions: new Map([
          [loop.id, { ...loop, tags: [...loop.tags], loop: { ...current, end: current.start } }],
        ]),
        clips: new Map([
          ...state.project.clips,
          [
            firstStep.id,
            { ...firstStep, source: { ...firstStep.source, start: firstStep.source.length } },
          ],
        ]),
      },
    };
    const difference = diffStates(state, after);
    expect(difference.regions.changed).toEqual([{ id: loop.id, fields: ['loop'] }]);
    expect(difference.clips.changed).toEqual([{ id: firstStep.id, fields: ['source'] }]);

    const withoutLoop: Region = {
      id: loop.id,
      assetId: loop.assetId,
      displayName: loop.displayName,
      basis: loop.basis,
      start: loop.start,
      end: loop.end,
      tags: loop.tags,
      operations: loop.operations,
    };
    const unlooped: ProjectState = {
      ...state,
      project: { ...state.project, regions: new Map([[loop.id, withoutLoop]]) },
    };
    expect(diffStates(state, unlooped).regions.changed).toEqual([
      { id: loop.id, fields: ['loop'] },
    ]);
  });

  it('compares an asset’s edits and a region’s processing by what they hold', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const { footstep } = fixture.assets;
    const { loop } = fixture.regions;
    const range = { start: derivedSampleCount(0), end: derivedSampleCount(100) };
    const louder = (gain: number): EditOperation => ({
      id: unsafeBrandId<'EditOperationId'>('0000eeee-0001'),
      kind: 'process',
      range: { ...range },
      channels: [0],
      edit: { kind: 'gain', gain },
    });
    const inverted = (basis: number): RegionOperation => ({
      id: unsafeBrandId<'EditOperationId'>('0000eeee-0002'),
      basis,
      range: { ...range },
      edit: { kind: 'invert' },
    });
    const edited = (gain: number, basis: number): ProjectState => ({
      ...state,
      project: {
        ...state.project,
        assets: new Map([
          ...state.project.assets,
          [footstep.id, { ...footstep, edits: [louder(gain)] }],
        ]),
        regions: new Map([[loop.id, { ...loop, operations: [inverted(basis)] }]]),
      },
    });

    // Built apart, so only what they hold can say they are the same.
    expect(diffStates(edited(0.5, 0), edited(0.5, 0)).assets.changed).toEqual([]);
    expect(diffStates(edited(0.5, 0), edited(0.5, 0)).regions.changed).toEqual([]);

    const difference = diffStates(edited(0.5, 0), edited(0.25, 1));
    expect(difference.assets.changed).toEqual([{ id: footstep.id, fields: ['edits'] }]);
    expect(difference.regions.changed).toEqual([{ id: loop.id, fields: ['operations'] }]);
    expect(diffStates(state, edited(0.5, 0)).assets.changed).toEqual([
      { id: footstep.id, fields: ['edits'] },
    ]);
  });

  it('names a source whose file’s audio shape changed', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const { footstep } = fixture.assets;
    const source = state.sources.get(footstep.id);
    if (source === undefined) throw new Error('Every fixture asset has a source.');
    const withAudio = (declared: number): ProjectState => ({
      ...state,
      sources: new Map([
        ...state.sources,
        [
          footstep.id,
          {
            ...source,
            provenance: {
              importedAt: 1,
              byteLength: 1,
              mediaType: 'audio/wav',
              originProjectId: state.project.id,
              audio: {
                container: 'wav',
                sampleRate: footstep.sampleRate,
                encoding: 'integer',
                bitDepth: 24,
                byteOrder: 'little',
                frames: footstep.length,
                declaredFrames: derivedSampleCount(declared),
              },
            },
          },
        ],
      ]),
    });
    expect(
      diffStates(withAudio(footstep.length), withAudio(footstep.length)).sources.changed,
    ).toEqual([]);
    expect(
      diffStates(withAudio(footstep.length), withAudio(footstep.length + 1)).sources.changed,
    ).toEqual([{ id: footstep.id, fields: ['provenance'] }]);
  });

  it('names an asset whose media changed among the sources', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const { footstep } = fixture.assets;
    const source = state.sources.get(footstep.id);
    if (source?.media.kind !== 'managed') throw new Error('Every fixture source is managed.');
    const after: ProjectState = {
      ...state,
      sources: new Map([
        ...state.sources,
        [footstep.id, { ...source, media: { ...source.media, contentId: contentOf('f') } }],
      ]),
    };
    expect(diffStates(state, after).sources.changed).toEqual([
      { id: footstep.id, fields: ['media'] },
    ]);
  });

  it('compares effect chains processor by processor: added, removed, moved, switched and set', () => {
    const { state, fixture, chain } = fixtureState(sampleProject());
    const gain = fixture.ids.next<'ParameterId'>();
    const shape = fixture.ids.next<'ParameterId'>();
    const eq = processor(fixture, 'parametric-eq', [
      [gain, 0.5],
      [shape, 'low-shelf'],
    ]);
    const compressor = processor(fixture, 'compressor');
    const limiter = processor(fixture, 'limiter');
    const reverb = processor(fixture, 'reverb');
    const before = withChain(state, { ...chain, processors: [eq, compressor, limiter] });
    const after = withChain(state, {
      ...chain,
      processors: [
        reverb,
        { ...limiter, enabled: false },
        { ...eq, values: new Map<ParameterId, string | number | boolean>([[gain, 0.75]]) },
      ],
    });

    expect(diffStates(before, after).effectChains).toEqual([
      {
        id: chain.id,
        change: 'changed',
        processors: [
          {
            id: reverb.id,
            change: 'added',
            typeKey: 'reverb',
            after: 0,
            moved: false,
            fields: [],
            parameters: [],
          },
          {
            id: limiter.id,
            change: 'changed',
            typeKey: 'limiter',
            before: 2,
            after: 1,
            moved: true,
            fields: ['enabled'],
            parameters: [],
          },
          {
            id: eq.id,
            change: 'changed',
            typeKey: 'parametric-eq',
            before: 0,
            after: 2,
            moved: false,
            fields: [],
            parameters: [
              { id: gain, before: 0.5, after: 0.75 },
              { id: shape, before: 'low-shelf' },
            ].sort((left, right) => (left.id < right.id ? -1 : 1)),
          },
          {
            id: compressor.id,
            change: 'removed',
            typeKey: 'compressor',
            before: 1,
            moved: false,
            fields: [],
            parameters: [],
          },
        ],
      },
    ]);
  });

  it('does not call a processor moved because one was inserted before it', () => {
    const { state, fixture, chain } = fixtureState(sampleProject());
    const first = processor(fixture, 'eq');
    const second = processor(fixture, 'compressor');
    const inserted = processor(fixture, 'gate');
    const before = withChain(state, { ...chain, processors: [first, second] });
    const after = withChain(state, { ...chain, processors: [inserted, first, second] });
    const [difference] = diffStates(before, after).effectChains;
    expect(
      difference?.processors.map((entry) => [entry.typeKey, entry.change, entry.moved]),
    ).toEqual([['gate', 'added', false]]);
  });

  it('lists every processor of an added or removed chain, with its parameters', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const level = fixture.ids.next<'ParameterId'>();
    const added: EffectChain = {
      id: fixture.ids.next<'EffectChainId'>(),
      processors: [processor(fixture, 'gain', [[level, 1]])],
    };
    const after = withChain(state, added);
    expect(diffStates(state, after).effectChains).toEqual([
      {
        id: added.id,
        change: 'added',
        processors: [
          expect.objectContaining({
            change: 'added',
            after: 0,
            parameters: [{ id: level, after: 1 }],
          }),
        ],
      },
    ]);
    expect(diffStates(after, state).effectChains).toEqual([
      {
        id: added.id,
        change: 'removed',
        processors: [
          expect.objectContaining({
            change: 'removed',
            before: 0,
            parameters: [{ id: level, before: 1 }],
          }),
        ],
      },
    ]);
  });

  it('is the same whatever order the maps were built in', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const reversed: ProjectState = {
      ...state,
      project: {
        ...state.project,
        clips: new Map([...state.project.clips].reverse()),
        tracks: new Map(
          [...state.project.tracks].reverse().map(([id, track]) => [id, { ...track, gain: 0.1 }]),
        ),
      },
    };
    const forward: ProjectState = {
      ...state,
      project: {
        ...state.project,
        tracks: new Map(
          [...state.project.tracks].map(([id, track]) => [id, { ...track, gain: 0.1 }]),
        ),
      },
    };
    expect(diffStates(state, reversed)).toEqual(diffStates(state, forward));
    expect(diffStates(state, forward).tracks.changed.map(({ id }) => id)).toEqual(
      [fixture.tracks.foley.id, fixture.tracks.background.id].sort(),
    );
  });
});

describe('the entities a change affected', () => {
  it('gathers each kind’s identifiers, sorted and once, counting a changed source as its asset', () => {
    const { state, fixture, chain } = fixtureState(sampleProject());
    const { footstep, ambience } = fixture.assets;
    const source = state.sources.get(ambience.id);
    if (source?.media.kind !== 'managed') throw new Error('Every fixture source is managed.');
    const after: ProjectState = {
      project: {
        ...state.project,
        displayName: 'Renamed',
        assets: new Map([
          ...state.project.assets,
          [footstep.id, { ...footstep, displayName: 'Step' }],
        ]),
        effectChains: new Map([[chain.id, { ...chain, processors: [processor(fixture, 'eq')] }]]),
        markers: new Map(),
      },
      sources: new Map([
        ...state.sources,
        [ambience.id, { media: { ...source.media, byteLength: 1 } }],
      ]),
    };
    const affected = affectedBy(state, after);
    expect(affected).toEqual({
      assets: [footstep.id, ambience.id].sort(),
      tracks: [],
      buses: [],
      clips: [],
      regions: [],
      markers: [fixture.markers.start.id],
      effectChains: [chain.id],
      project: true,
    });
  });
});

describe('the items of a reordered list that kept their order', () => {
  it.each([
    [[], []],
    [
      [0, 1, 2],
      [0, 1, 2],
    ],
    [
      [2, 0, 1],
      [1, 2],
    ],
    [[1, 0], [1]],
    [
      [0, 3, 1, 2],
      [0, 2, 3],
    ],
  ])('in %j are at %j', (sequence, kept) => {
    expect([...unmovedPositions(sequence)].sort()).toEqual(kept);
  });
});
