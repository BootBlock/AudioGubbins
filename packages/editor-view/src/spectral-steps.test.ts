/**
 * A spectral selection widened and narrowed by a step of its view
 * (ADR-0082): the outline's edges move by the step, every shape is carried
 * with them, and a step that would change nothing or leave nothing is none.
 */

import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  NO_FEATHER,
  maskOutline,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';

import { SpectralStep, maskSteppedInFrequency, maskSteppedInTime } from './spectral-steps.js';
import { at } from './testing/scene.js';
import type { SpectralSettings } from './view-state.js';

const LENGTH = at(48_000);

const LOGARITHMIC: SpectralSettings = {
  frequencyScale: 'logarithmic',
  lowest: 20,
  highest: 20_480,
};
const LINEAR: SpectralSettings = { frequencyScale: 'linear', lowest: 0, highest: 20_000 };

function rectangle(
  start: number,
  end: number,
  low: number,
  high: number,
  effect: MaskEffect = MaskEffect.Add,
): SpectralShape {
  return {
    kind: 'rectangle',
    effect,
    range: { start: at(start), end: at(end) },
    band: { low, high },
  };
}

function maskOf(...shapes: [SpectralShape, ...SpectralShape[]]): SpectralMask {
  return { shapes, feather: NO_FEATHER };
}

describe('a spectral selection stepped in time', () => {
  it('moves both ends out by the step, and in again', () => {
    const mask = maskOf(rectangle(10_000, 20_000, 100, 400));
    const wider = maskSteppedInTime(mask, SpectralStep.Widen, 500, LENGTH);
    expect(wider === undefined ? undefined : maskOutline(wider)).toMatchObject({
      start: 9_500,
      end: 20_500,
    });
    const narrower = maskSteppedInTime(mask, SpectralStep.Narrow, 500, LENGTH);
    expect(narrower === undefined ? undefined : maskOutline(narrower)).toMatchObject({
      start: 10_500,
      end: 19_500,
    });
  });

  it('carries each shape within the selection, one that takes away included', () => {
    const mask = maskOf(
      rectangle(10_000, 20_000, 100, 400),
      rectangle(14_000, 16_000, 200, 300, MaskEffect.Subtract),
    );
    const wider = maskSteppedInTime(mask, SpectralStep.Widen, 1_000, LENGTH);
    expect(wider?.shapes[1]).toEqual(rectangle(13_800, 16_200, 200, 300, MaskEffect.Subtract));
  });

  it('stops at the ends of the audio, and is none once it is there', () => {
    const mask = maskOf(rectangle(200, 47_900, 100, 400));
    const wider = maskSteppedInTime(mask, SpectralStep.Widen, 500, LENGTH);
    expect(wider === undefined ? undefined : maskOutline(wider)).toMatchObject({
      start: 0,
      end: 48_000,
    });
    expect(
      wider === undefined ? 'none' : maskSteppedInTime(wider, SpectralStep.Widen, 500, LENGTH),
    ).toBeUndefined();
  });

  it('is none where it would narrow the selection to nothing', () => {
    const mask = maskOf(rectangle(10_000, 10_800, 100, 400));
    expect(maskSteppedInTime(mask, SpectralStep.Narrow, 500, LENGTH)).toBeUndefined();
  });
});

describe('a spectral selection stepped in frequency', () => {
  it('moves the band by an equal ratio on a logarithmic axis', () => {
    // The axis spans ten octaves, so a twentieth of it is half an octave.
    const mask = maskOf(rectangle(10_000, 20_000, 400, 1_600));
    const wider = maskSteppedInFrequency(mask, SpectralStep.Widen, LOGARITHMIC, 24_000);
    const band = wider === undefined ? undefined : maskOutline(wider);
    expect(band?.low).toBeCloseTo(400 / Math.SQRT2, 6);
    expect(band?.high).toBeCloseTo(1_600 * Math.SQRT2, 6);
  });

  it('moves the band by an equal width on a linear axis', () => {
    const mask = maskOf(rectangle(10_000, 20_000, 4_000, 8_000));
    const narrower = maskSteppedInFrequency(mask, SpectralStep.Narrow, LINEAR, 24_000);
    const band = narrower === undefined ? undefined : maskOutline(narrower);
    expect(band?.low).toBeCloseTo(5_000, 6);
    expect(band?.high).toBeCloseTo(7_000, 6);
  });

  it('keeps a band reaching nothing at nothing as it widens on a logarithmic axis', () => {
    const mask = maskOf(rectangle(10_000, 20_000, 0, 1_000));
    const wider = maskSteppedInFrequency(mask, SpectralStep.Widen, LOGARITHMIC, 24_000);
    expect(wider === undefined ? undefined : maskOutline(wider).low).toBe(0);
    const narrower = maskSteppedInFrequency(mask, SpectralStep.Narrow, LOGARITHMIC, 24_000);
    expect(narrower === undefined ? undefined : maskOutline(narrower).low).toBeCloseTo(
      20 * Math.SQRT2,
      6,
    );
  });

  it('stops at the highest frequency the audio holds, and is none once both edges are there', () => {
    const mask = maskOf(rectangle(10_000, 20_000, 0, 23_000));
    const wider = maskSteppedInFrequency(mask, SpectralStep.Widen, LINEAR, 24_000);
    expect(wider === undefined ? undefined : maskOutline(wider)).toMatchObject({
      low: 0,
      high: 24_000,
    });
    expect(
      wider === undefined
        ? 'none'
        : maskSteppedInFrequency(wider, SpectralStep.Widen, LINEAR, 24_000),
    ).toBeUndefined();
  });

  it('is none where it would narrow the band to nothing', () => {
    const mask = maskOf(rectangle(10_000, 20_000, 4_000, 5_000));
    expect(maskSteppedInFrequency(mask, SpectralStep.Narrow, LINEAR, 24_000)).toBeUndefined();
  });

  it('carries a brush’s points and keeps its radii and the softness', () => {
    const mask: SpectralMask = {
      shapes: [
        {
          kind: 'stroke',
          effect: MaskEffect.Add,
          hardness: 0.5,
          points: [
            {
              position: at(10_000),
              frequency: 4_000,
              strength: 1,
              radius: { time: 100, frequency: 50 },
            },
            {
              position: at(12_000),
              frequency: 8_000,
              strength: 1,
              radius: { time: 100, frequency: 50 },
            },
          ],
        },
      ],
      feather: { time: 10, frequency: 10 },
    };
    const narrower = maskSteppedInFrequency(mask, SpectralStep.Narrow, LINEAR, 24_000);
    const [stroke] = narrower?.shapes ?? [];
    if (stroke?.kind !== 'stroke') throw new Error('The stroke was not kept.');
    const [first, second] = stroke.points.map((point) => point.frequency);
    expect(first).toBeCloseTo(5_000, 6);
    expect(second).toBeCloseTo(7_000, 6);
    expect(stroke.points.map((point) => point.radius)).toEqual([
      { time: 100, frequency: 50 },
      { time: 100, frequency: 50 },
    ]);
    expect(narrower?.feather).toEqual({ time: 10, frequency: 10 });
  });
});
