import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { clippedMask } from './mask-clipping.js';
import { spectralMaskOf } from './mask-decoding.js';
import { MAXIMUM_MASK_SHAPES, maskProblem } from './mask-validation.js';
import { spectralEditProblem, spectralPlacement, type SpectralEdit } from './spectral-edit.js';
import {
  MaskEffect,
  NO_FEATHER,
  maskOutline,
  maskSupport,
  masksEqual,
  translatedMask,
  type SpectralMask,
  type SpectralShape,
  type StrokePoint,
} from './spectral-mask.js';

const at = derivedSampleCount;

function rectangle(start: number, end: number, low = 100, high = 1_000): SpectralShape {
  return {
    kind: 'rectangle',
    effect: MaskEffect.Add,
    range: { start: at(start), end: at(end) },
    band: { low, high },
  };
}

const TRIANGLE: SpectralShape = {
  kind: 'polygon',
  effect: MaskEffect.Add,
  points: [
    { position: at(-20), frequency: 0 },
    { position: at(80), frequency: 0 },
    { position: at(80), frequency: 1_000 },
  ],
};

const FIRST_STROKE_POINT: StrokePoint = {
  position: at(10),
  frequency: 500,
  strength: 1,
  radius: { time: 5, frequency: 50 },
};

const STROKE: SpectralShape = {
  kind: 'stroke',
  effect: MaskEffect.Add,
  hardness: 0.5,
  points: [
    FIRST_STROKE_POINT,
    { position: at(30), frequency: 600, strength: 0.5, radius: { time: 5, frequency: 50 } },
  ],
};

function mask(...shapes: [SpectralShape, ...SpectralShape[]]): SpectralMask {
  return { shapes, feather: { time: 4, frequency: 40 } };
}

describe('a spectral mask’s bounds and movement', () => {
  it('outlines the adding shapes, and supports them out to the feather and each radius', () => {
    const one = mask(rectangle(20, 40), STROKE, {
      ...rectangle(0, 100),
      effect: MaskEffect.Subtract,
    });
    expect(maskOutline(one)).toEqual({ start: 10, end: 40, low: 100, high: 1_000 });
    expect(maskSupport(one)).toEqual({ start: 5, end: 44, low: 60, high: 1_040 });
  });

  it('moves every position, and compares masks by value', () => {
    const one = mask(rectangle(20, 40), STROKE);
    const moved = translatedMask(one, 100);
    expect(maskOutline(moved)).toEqual({ start: 110, end: 140, low: 100, high: 1_000 });
    expect(masksEqual(translatedMask(moved, -100), one)).toBe(true);
    expect(masksEqual(moved, one)).toBe(false);
    expect(
      masksEqual(mask(rectangle(20, 40)), { ...mask(rectangle(20, 40)), feather: NO_FEATHER }),
    ).toBe(false);
  });
});

describe('a spectral mask clipped to its asset', () => {
  it('drops a rectangle left empty, cuts a polygon at the ends and keeps a stroke’s points inside', () => {
    const clipped = clippedMask(mask(rectangle(40, 120), TRIANGLE, STROKE), 25);
    expect(clipped?.shapes).toEqual([
      {
        kind: 'polygon',
        effect: MaskEffect.Add,
        points: [
          { position: 0, frequency: 0 },
          { position: 25, frequency: 0 },
          { position: 25, frequency: 450 },
          { position: 0, frequency: 200 },
        ],
      },
      { ...STROKE, points: [FIRST_STROKE_POINT] },
    ]);
    expect(clippedMask(mask(rectangle(10, 120)), 25)?.shapes).toEqual([rectangle(10, 25)]);
  });

  it('keeps a mask that lies inside as the same value', () => {
    const inside = mask(rectangle(10, 20));
    expect(clippedMask(inside, 100)).toBe(inside);
  });

  it('leaves no mask once nothing that adds is left', () => {
    expect(
      clippedMask(
        mask(rectangle(200, 300), { ...rectangle(0, 50), effect: MaskEffect.Subtract }),
        100,
      ),
    ).toBeUndefined();
  });
});

describe('whether a spectral mask may stand', () => {
  it('accepts a mask within its timeline', () => {
    expect(maskProblem(mask(rectangle(0, 100), STROKE), 100)).toBeUndefined();
  });

  it.each([
    ['a rectangle past the audio', mask(rectangle(50, 101)), 100],
    ['a rectangle of no frequencies', mask(rectangle(0, 10, 500, 500)), 100],
    ['a frequency no audio has', mask(rectangle(0, 10, 0, 400_000)), 100],
    ['a polygon point outside the audio', mask(TRIANGLE), 100],
    ['only shapes that take away', mask({ ...rectangle(0, 10), effect: MaskEffect.Subtract }), 100],
    [
      'a softness in time alone',
      { ...mask(rectangle(0, 10)), feather: { time: 4, frequency: 0 } },
      100,
    ],
    [
      'a brush of no strength',
      mask({
        ...STROKE,
        points: [{ position: at(1), frequency: 1, strength: 0, radius: { time: 1, frequency: 1 } }],
      }),
      100,
    ],
    ['a hardness of one', mask({ ...STROKE, hardness: 1 }), 100],
  ])('refuses %s', (_, refused, length) => {
    expect(maskProblem(refused, length)).toBeTypeOf('string');
  });

  it('refuses more shapes than a mask may hold', () => {
    const shapes = Array.from({ length: MAXIMUM_MASK_SHAPES + 1 }, () => rectangle(0, 10));
    const [first, ...rest] = shapes;
    if (first === undefined) throw new Error('There are shapes.');
    expect(maskProblem({ shapes: [first, ...rest], feather: NO_FEATHER }, 100)).toBe(
      'The selection has too many shapes.',
    );
  });
});

describe('a spectral mask read back from a thread', () => {
  it('reads a cloned mask as the same value', () => {
    const one = clippedMask(mask(rectangle(0, 10), TRIANGLE, STROKE), 100);
    if (one === undefined) throw new Error('The mask lies in the audio.');
    expect(masksEqual(spectralMaskOf(structuredClone(one), 'mask'), one)).toBe(true);
  });

  it('refuses a shape of no known kind and a polygon of two points', () => {
    expect(() =>
      spectralMaskOf({ shapes: [{ kind: 'circle', effect: 'add' }], feather: NO_FEATHER }, 'mask'),
    ).toThrow(/mask\.shapes/u);
    expect(() =>
      spectralMaskOf(
        {
          shapes: [
            {
              kind: 'polygon',
              effect: 'add',
              points: [
                { position: 0, frequency: 0 },
                { position: 1, frequency: 1 },
              ],
            },
          ],
          feather: NO_FEATHER,
        },
        'mask',
      ),
    ).toThrow(/three or more points/u);
  });
});

describe('a spectral edit', () => {
  const chain = unsafeBrandId<'EffectChainId'>('33333333-chain-a');
  const chains = new Map<EffectChainId, EffectChain>([[chain, { id: chain, slots: [] }]]);
  const edit = (operation: SpectralEdit['operation'], resolution = 2_048): SpectralEdit => ({
    kind: 'spectral',
    mask: mask(rectangle(10, 20)),
    resolution,
    operation,
  });

  it('may stand with a known resolution, a reduction below one and a chain the project has', () => {
    expect(spectralEditProblem(edit({ kind: 'attenuate', gain: 0 }), 100, chains)).toBeUndefined();
    expect(spectralEditProblem(edit({ kind: 'heal' }), 100, chains)).toBeUndefined();
    expect(spectralEditProblem(edit({ kind: 'process', chain }), 100, chains)).toBeUndefined();
  });

  it.each([
    ['a resolution that is no power of two', edit({ kind: 'heal' }, 3_000)],
    ['a resolution past the longest', edit({ kind: 'heal' }, 32_768)],
    ['a reduction of one', edit({ kind: 'isolate', gain: 1 })],
    ['a reduction below nothing', edit({ kind: 'attenuate', gain: -0.5 })],
    [
      'a chain the project lacks',
      edit({ kind: 'process', chain: unsafeBrandId<'EffectChainId'>('33333333-chain-z') }),
    ],
  ])('is refused with %s', (_, refused) => {
    expect(spectralEditProblem(refused, 100, chains)).toBeTypeOf('string');
  });

  it('is placed over its mask widened by half a frame each side, within the audio, its mask moved', () => {
    const placed = spectralPlacement(mask(rectangle(5_000, 6_000)), 2_048, 100_000);
    expect(placed?.start).toBe(5_000 - 4 - 1_024);
    expect(placed?.end).toBe(6_000 + 4 + 1_024);
    expect(maskOutline(placed?.mask ?? mask(rectangle(0, 1))).start).toBe(1_028);
    const atEdge = spectralPlacement(mask(rectangle(100, 6_000)), 2_048, 6_500);
    expect([atEdge?.start, atEdge?.end]).toEqual([0, 6_500]);
  });
});
