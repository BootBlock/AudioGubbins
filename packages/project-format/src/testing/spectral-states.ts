/**
 * A project state with spectral edits, for tests (ADR-0081): the reference
 * state with every operation a spectral edit has, every kind of shape a mask
 * has, adding and taking away, hard and feathered, in the footstep's chain, in
 * its region's processing, and in the plan of a paste of the spectrally edited
 * footstep, so a round trip of the three places hangs on no seed.
 */

import {
  HIGHEST_MASK_FREQUENCY,
  LARGEST_SPECTRAL_RESOLUTION,
  MaskEffect,
  NO_FEATHER,
  SMALLEST_SPECTRAL_RESOLUTION,
  assetPlan,
  derivedSampleCount,
  instantiateProcessor,
  slicePlan,
  type Asset,
  type EditOperation,
  type EffectChain,
  type EffectChainId,
  type IdGenerator,
  type Region,
  type RegionOperation,
  type SampleCount,
  type SpectralEdit,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';
import {
  expectSuccess,
  TEST_CATALOGUE,
  TEST_ENGINE,
  TEST_FILTER,
} from '@audiogubbins/domain/testing';

import type { ProjectState } from '../project-state.js';
import { referenceState, type SampleProject } from './project-states.js';

function at(position: number): SampleCount {
  return derivedSampleCount(position);
}

function rectangle(
  effect: MaskEffect,
  start: number,
  end: number,
  low: number,
  high: number,
): SpectralShape {
  return {
    kind: 'rectangle',
    effect,
    range: { start: at(start), end: at(end) },
    band: { low, high },
  };
}

/** A polygon of the three or more points given as position and frequency. */
function polygon(
  effect: MaskEffect,
  [a, b, c, ...rest]: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    ...(readonly [number, number])[],
  ],
): SpectralShape {
  const point = ([position, frequency]: readonly [number, number]) => ({
    position: at(position),
    frequency,
  });
  return { kind: 'polygon', effect, points: [point(a), point(b), point(c), ...rest.map(point)] };
}

/** A stroke of the points given as position, frequency, strength and radius. */
function stroke(
  effect: MaskEffect,
  hardness: number,
  [first, ...rest]: readonly [
    readonly [number, number, number, number, number],
    ...(readonly [number, number, number, number, number])[],
  ],
): SpectralShape {
  const point = ([position, frequency, strength, time, hertz]: readonly [
    number,
    number,
    number,
    number,
    number,
  ]) => ({ position: at(position), frequency, strength, radius: { time, frequency: hertz } });
  return { kind: 'stroke', effect, hardness, points: [point(first), ...rest.map(point)] };
}

function spectral(
  mask: SpectralMask,
  resolution: number,
  operation: SpectralEdit['operation'],
): SpectralEdit {
  return { kind: 'spectral', mask, resolution, operation };
}

/**
 * The footstep's spectral edits, over its 24,000 frames: one of each
 * operation, between them every kind of shape adding and taking away, at the
 * smallest and the largest resolution, with a feather and without.
 */
function chainEdits(ids: IdGenerator, chain: EffectChainId): readonly EditOperation[] {
  const range = (start: number, end: number) => ({ start: at(start), end: at(end) });
  return [
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'process',
      range: range(1_000, 9_000),
      channels: [0],
      edit: spectral(
        {
          shapes: [
            rectangle(MaskEffect.Add, 0, 4_000, 100, 4_000.5),
            polygon(MaskEffect.Subtract, [
              [500, 200],
              [3_000, 3_000.25],
              [1_500, 0.1 + 0.2],
            ]),
          ],
          feather: { time: 64, frequency: 150.5 },
        },
        SMALLEST_SPECTRAL_RESOLUTION,
        { kind: 'attenuate', gain: 0 },
      ),
    },
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'process',
      range: range(4_000, 20_000),
      edit: spectral(
        {
          shapes: [
            stroke(MaskEffect.Add, 0.75, [
              [0, 440, 1, 256, 50],
              [8_000, 1_000, 0.5, 1_024.5, 300],
              [16_000, HIGHEST_MASK_FREQUENCY, 1e-7, 16_001, HIGHEST_MASK_FREQUENCY],
            ]),
          ],
          feather: NO_FEATHER,
        },
        LARGEST_SPECTRAL_RESOLUTION,
        { kind: 'isolate', gain: 0.1 + 0.2 },
      ),
    },
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'process',
      range: range(10_000, 12_000),
      edit: spectral(
        {
          shapes: [
            polygon(MaskEffect.Add, [
              [0, 0],
              [2_000, 0],
              [2_000, 8_000],
              [0, 8_000],
            ]),
            rectangle(MaskEffect.Subtract, 900, 1_100, 0, HIGHEST_MASK_FREQUENCY),
            stroke(MaskEffect.Subtract, 0, [[1_000, 4_000, Number.MIN_VALUE, 0.5, 0.5]]),
          ],
          feather: { time: 2_001, frequency: HIGHEST_MASK_FREQUENCY },
        },
        2_048,
        { kind: 'heal' },
      ),
    },
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'process',
      range: range(12_000, 24_000),
      edit: spectral(
        {
          shapes: [
            rectangle(MaskEffect.Add, 0, 12_000, 20, 20_000),
            stroke(MaskEffect.Add, 1 - Number.EPSILON / 2, [
              [6_000, 9_000, 1, 1, 1],
              [12_000, 0, 0.25, 12_001, 100],
            ]),
          ],
          feather: NO_FEATHER,
        },
        512,
        { kind: 'process', chain },
      ),
    },
  ];
}

/**
 * Processing for the footstep's region, which covers its source: one of each
 * operation, placed at bases before, among and after the chain's spectral
 * edits and its paste.
 */
function regionProcessing(ids: IdGenerator, chain: EffectChainId): readonly RegionOperation[] {
  const range = (start: number, end: number) => ({ start: at(start), end: at(end) });
  return [
    {
      id: ids.next<'EditOperationId'>(),
      basis: 0,
      range: range(0, 4_800),
      edit: spectral(
        {
          shapes: [
            stroke(MaskEffect.Add, 0.5, [
              [0, 100, 0.5, 4_801, 100],
              [4_800, 200, 1, 2, 150.5],
            ]),
          ],
          feather: NO_FEATHER,
        },
        1_024,
        { kind: 'attenuate', gain: 1 - Number.EPSILON / 2 },
      ),
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 2,
      range: range(2_000, 2_400),
      channels: [0],
      edit: spectral(
        {
          shapes: [
            polygon(MaskEffect.Add, [
              [0, 50],
              [400, 50],
              [200, 9_000],
            ]),
          ],
          feather: { time: 0.5, frequency: Number.MIN_VALUE },
        },
        4_096,
        { kind: 'isolate', gain: 1e-7 },
      ),
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 4,
      range: range(23_000, 24_000),
      edit: spectral(
        {
          shapes: [
            rectangle(MaskEffect.Add, 0, 1_000, 0, 1),
            rectangle(MaskEffect.Subtract, 0, 1, 0.5, 1),
          ],
          feather: NO_FEATHER,
        },
        8_192,
        { kind: 'heal' },
      ),
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 5,
      range: range(30_000, 48_000),
      edit: spectral(
        {
          shapes: [rectangle(MaskEffect.Add, 0, 18_000, 1_000, 2_000)],
          feather: { time: 18_001, frequency: 1 },
        },
        16_384,
        { kind: 'process', chain },
      ),
    },
  ];
}

/**
 * The reference state with spectral edits of every operation and every kind
 * of shape in the footstep's chain, in the plan of a paste of the edited
 * footstep, and in the processing of its region; the `process` edits run a
 * chain of the test catalogue's filter, which keeps the audio's channels.
 */
export function spectralState(fixture: SampleProject): ProjectState {
  const state = referenceState(fixture);
  const { ids } = fixture;
  const footstep = state.project.assets.get(fixture.assets.footstep.id);
  if (footstep === undefined) throw new Error('The reference state has no footstep.');

  const chain: EffectChain = {
    id: ids.next<'EffectChainId'>(),
    slots: [instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER)],
  };
  const chains = new Map([...state.project.effectChains, [chain.id, chain]]);
  const edits = chainEdits(ids, chain.id);
  const plan = expectSuccess(
    assetPlan(
      { ...footstep, edits },
      {
        chains,
        takeStacks: state.project.takeStacks,
        assets: state.project.assets,
        catalogue: TEST_CATALOGUE,
        engine: TEST_ENGINE,
      },
    ),
  );
  const paste: EditOperation = {
    id: ids.next<'EditOperationId'>(),
    kind: 'insert',
    at: at(24_000),
    payload: expectSuccess(slicePlan(plan, 0, 24_000)),
  };
  const edited: Asset = { ...footstep, edits: [...edits, paste] };
  const processing = regionProcessing(ids, chain.id);
  const regions = new Map(
    [...state.project.regions].map(([id, region]): [Region['id'], Region] => [
      id,
      region.assetId === footstep.id ? { ...region, operations: [...processing] } : region,
    ]),
  );
  return {
    ...state,
    project: {
      ...state.project,
      assets: new Map([...state.project.assets, [footstep.id, edited]]),
      regions,
      effectChains: chains,
    },
  };
}
