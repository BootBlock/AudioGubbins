import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import type { DifferenceNames, StateDifference } from '@audiogubbins/history';

import { differenceLines } from './difference-words.js';

const NONE = { added: [], removed: [], changed: [] };

const SAME: StateDifference = {
  project: [],
  assets: NONE,
  sources: NONE,
  tracks: NONE,
  buses: NONE,
  clips: NONE,
  regions: NONE,
  markers: NONE,
  effectChains: [],
};

const DRUMS = unsafeBrandId<'TrackId'>('00000000-0000-4000-8000-000000000001');
const VOX = unsafeBrandId<'TrackId'>('00000000-0000-4000-8000-000000000002');
const INTRO = unsafeBrandId<'MarkerId'>('00000000-0000-4000-8000-000000000003');
const CHAIN = unsafeBrandId<'EffectChainId'>('00000000-0000-4000-8000-000000000004');
const EQ = unsafeBrandId<'ProcessorId'>('00000000-0000-4000-8000-000000000005');
const LEVEL = unsafeBrandId<'ParameterId'>('00000000-0000-4000-8000-000000000006');

const NAMES: DifferenceNames = {
  entities: new Map<string, string>([
    [DRUMS, 'Drums'],
    [VOX, 'Vocals'],
    [INTRO, 'Intro'],
  ]),
  chains: new Map([[CHAIN, { kind: 'track', name: 'Drums' }]]),
};

describe('what differs between two compared states, in words (REQ-STOR-195)', () => {
  it('says each entity by name, which side alone holds it, and what of it differs', () => {
    const difference: StateDifference = {
      ...SAME,
      project: ['displayName', 'sampleRate'],
      tracks: {
        added: [VOX],
        removed: [],
        changed: [{ id: DRUMS, fields: ['gain', 'muted', 'pan'] }],
      },
      markers: { added: [], removed: [INTRO], changed: [] },
      effectChains: [
        {
          id: CHAIN,
          change: 'changed',
          processors: [
            {
              id: EQ,
              change: 'changed',
              typeKey: 'parametric-eq',
              before: 0,
              after: 1,
              moved: true,
              fields: ['enabled'],
              parameters: [{ id: LEVEL, before: 0.5, after: 0.75 }],
            },
          ],
        },
      ],
    };

    expect(differenceLines(difference, NAMES)).toEqual([
      'The project differs in its name and sample rate.',
      'The track "Vocals" is in B only.',
      'The track "Drums" differs in its gain, mute and pan.',
      'The marker "Intro" is in A only.',
      'The effects of the track "Drums": "parametric-eq" differs in its place, whether it is on and a setting (0.5 in A, 0.75 in B).',
    ]);
  });

  it('says a region’s moved boundaries once, and its processing and an asset’s edits', () => {
    const region = unsafeBrandId<'RegionId'>('00000000-0000-4000-8000-000000000007');
    const asset = unsafeBrandId<'AssetId'>('00000000-0000-4000-8000-000000000008');
    const difference: StateDifference = {
      ...SAME,
      regions: {
        added: [],
        removed: [],
        changed: [{ id: region, fields: ['basis', 'start', 'end', 'operations'] }],
      },
      assets: { added: [], removed: [], changed: [{ id: asset, fields: ['edits'] }] },
    };
    const names: DifferenceNames = {
      entities: new Map<string, string>([
        [region, 'Walk loop'],
        [asset, 'Gravel'],
      ]),
      chains: new Map(),
    };

    expect(differenceLines(difference, names)).toEqual([
      'The region "Walk loop" differs in its boundaries and processing.',
      'The asset "Gravel" differs in its edits.',
    ]);
  });

  it('says so where the two states are the same', () => {
    expect(differenceLines(SAME, { entities: new Map(), chains: new Map() })).toEqual([
      'The two states are the same.',
    ]);
  });
});
