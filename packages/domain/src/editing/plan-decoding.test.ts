import { describe, expect, it } from 'vitest';

import { ambisonicLayout } from '../audio/ambisonic-layout.js';
import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  StandardLayouts,
} from '../audio/channel-layout.js';
import { unsafeBrandId } from '../identity/branded-id.js';
import { SummingLaw, instantiateProcessor, type EffectChain } from '../processing/effect-chain.js';
import { OTHER_RATE, frames } from '../testing/editing-fixtures.js';
import { TEST_DENOISER, TEST_UPMIXER } from '../testing/test-processors.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { FadeShape } from './fades.js';
import { editPlanFrom } from './plan-decoding.js';
import type { EditPlan, PlanSegment } from './plan.js';

const ASSET = unsafeBrandId<'AssetId'>('0000bbbb-0001');

const FIRST_ORDER = expectSuccess(
  ambisonicLayout({
    order: 1,
    ordering: AmbisonicOrdering.Acn,
    normalisation: AmbisonicNormalisation.Sn3d,
  }),
);
const FUMA = expectSuccess(
  ambisonicLayout({
    order: 2,
    ordering: AmbisonicOrdering.FuMa,
    normalisation: AmbisonicNormalisation.FuMa,
  }),
);

const CHAIN: EffectChain = {
  id: unsafeBrandId<'EffectChainId'>('33333333-aaaa'),
  slots: [
    instantiateProcessor(unsafeBrandId<'ProcessorId'>('22222222-aaaa'), TEST_UPMIXER),
    {
      kind: 'group',
      id: unsafeBrandId<'ProcessorGroupId'>('44444444-aaaa'),
      enabled: true,
      soloed: false,
      mix: 0.5,
      summing: SummingLaw.Mean,
      branches: [
        {
          slots: [
            instantiateProcessor(unsafeBrandId<'ProcessorId'>('22222222-bbbb'), TEST_DENOISER),
          ],
        },
        { slots: [] },
      ],
    },
  ],
};

function reading(source: PlanSegment['source'], length: number): PlanSegment {
  return { source, start: frames(0), length: frames(length), reversed: false, stages: [] };
}

/**
 * A plan with every kind of stream processing and an ambisonic layout: the
 * sound reads a chain-processed stream and a stretched one, and the stretched
 * one is first-order ambisonic, mixed down to stereo where the sound reads it.
 */
const PLAN: EditPlan = {
  streams: [
    {
      sampleRate: OTHER_RATE,
      layout: StandardLayouts.stereo,
      segments: [
        reading({ kind: 'stream', stream: 1 }, 10),
        {
          ...reading({ kind: 'stream', stream: 2 }, 20),
          reversed: true,
          stages: [
            {
              kind: 'gain',
              from: 0,
              to: 20,
              channels: [0],
              gain: {
                kind: 'fade',
                origin: 19,
                step: -1,
                length: 20,
                shape: FadeShape.EqualPower,
                rising: true,
              },
            },
            {
              kind: 'matrix',
              matrix: [
                [0.5, 0.5, 0, 0],
                [0.5, -0.5, 0, 0],
              ],
            },
          ],
        },
      ],
    },
    {
      sampleRate: OTHER_RATE,
      layout: StandardLayouts.stereo,
      segments: [reading({ kind: 'media', asset: ASSET }, 10)],
      processing: { kind: 'chain', chain: CHAIN, input: StandardLayouts.mono },
    },
    {
      sampleRate: OTHER_RATE,
      layout: FIRST_ORDER,
      segments: [reading({ kind: 'media', asset: ASSET }, 40)],
      processing: { kind: 'stretch', length: frames(20) },
    },
  ],
};

type Fields = Record<string, unknown>;

/** The plan as a clone gives it, with `change` made to its stream `place`, read back. */
function readWith(place: number, change: (stream: Fields) => void) {
  const clone: Fields = { ...structuredClone(PLAN) };
  const stream = (clone['streams'] as Fields[])[place];
  if (stream === undefined) throw new Error('The fixture plan has that stream.');
  change(stream);
  return editPlanFrom(clone);
}

describe('editPlanFrom', () => {
  it('reads a structured clone of a plan back as the plan, its chain, stretch and ambisonic layout included', () => {
    expect(expectSuccess(editPlanFrom(structuredClone(PLAN)))).toEqual(PLAN);
  });

  it('rebuilds a Furse-Malham layout from its convention, so its channels keep their meaning', () => {
    const plan: EditPlan = {
      streams: [
        {
          sampleRate: OTHER_RATE,
          layout: FUMA,
          segments: [reading({ kind: 'media', asset: ASSET }, 1)],
        },
      ],
    };
    const read = expectSuccess(editPlanFrom(structuredClone(plan)));
    expect(read).toEqual(plan);
    expect(read.streams[0].layout.ambisonic?.ordering).toBe(AmbisonicOrdering.FuMa);
  });

  it('keeps processing absent where a stream had none, so a read plan processes nothing extra', () => {
    const read = expectSuccess(editPlanFrom(structuredClone(PLAN)));
    expect('processing' in read.streams[0]).toBe(false);
  });

  const refused: readonly (readonly [string, number, (stream: Fields) => void])[] = [
    ['processing that is not a record', 1, (stream) => (stream['processing'] = 'chain')],
    [
      'processing of an unknown kind',
      1,
      (stream) => (stream['processing'] = { kind: 'pitch-shift', length: 20 }),
    ],
    [
      'a stretch of no whole length',
      2,
      (stream) => (stream['processing'] = { kind: 'stretch', length: 20.5 }),
    ],
    [
      'a stretch of a negative length',
      2,
      (stream) => (stream['processing'] = { kind: 'stretch', length: -1 }),
    ],
    [
      'a chain that is malformed',
      1,
      (stream) =>
        (stream['processing'] = {
          kind: 'chain',
          chain: { id: CHAIN.id, slots: [{ kind: 'plugin' }] },
          input: StandardLayouts.mono,
        }),
    ],
    [
      'a chain whose shape fails',
      1,
      (stream) =>
        (stream['processing'] = {
          kind: 'chain',
          chain: { id: CHAIN.id, slots: [CHAIN.slots[0], CHAIN.slots[0]] },
          input: StandardLayouts.mono,
        }),
    ],
    [
      'a chain with no input layout',
      1,
      (stream) => (stream['processing'] = { kind: 'chain', chain: CHAIN }),
    ],
    [
      'an ambisonic ordering no format has',
      2,
      (stream) =>
        (stream['layout'] = {
          roles: FIRST_ORDER.roles,
          ambisonic: { order: 1, ordering: 'zigzag', normalisation: 'sn3d' },
        }),
    ],
    [
      'an ambisonic normalisation no format has',
      2,
      (stream) =>
        (stream['layout'] = {
          roles: FIRST_ORDER.roles,
          ambisonic: { order: 1, ordering: 'acn', normalisation: 'loud' },
        }),
    ],
    [
      'a Furse-Malham ordering with another scaling',
      2,
      (stream) =>
        (stream['layout'] = {
          roles: FIRST_ORDER.roles,
          ambisonic: { order: 1, ordering: 'fuma', normalisation: 'sn3d' },
        }),
    ],
    [
      'an ambisonic order whose set has more channels than any layout',
      2,
      (stream) =>
        (stream['layout'] = {
          roles: FIRST_ORDER.roles,
          ambisonic: { order: 16, ordering: 'acn', normalisation: 'sn3d' },
        }),
    ],
    [
      'an ambisonic order that is not whole',
      2,
      (stream) =>
        (stream['layout'] = {
          roles: FIRST_ORDER.roles,
          ambisonic: { order: 1.5, ordering: 'acn', normalisation: 'sn3d' },
        }),
    ],
  ];

  it.each(refused)(
    'refuses %s in stream %i rather than handing a worker a plan it cannot trust',
    (_, place, change) => {
      expect(expectFailureCode(readWith(place, change))).toBe('editing.plan-unreadable');
    },
  );

  it('refuses a value with no stream, or that is not a plan', () => {
    for (const value of [undefined, null, 'plan', { streams: [] }, { streams: 'one' }]) {
      expect(expectFailureCode(editPlanFrom(value))).toBe('editing.plan-unreadable');
    }
  });
});
