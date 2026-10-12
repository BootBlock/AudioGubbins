import { describe, expect, it } from 'vitest';

import { derivedSampleCount } from '../time/sample-time.js';
import { MaskWeights } from './mask-weight.js';
import {
  MaskEffect,
  NO_FEATHER,
  type SpectralMask,
  type SpectralShape,
  type StrokePoint,
} from './spectral-mask.js';

const at = derivedSampleCount;

function rectangle(
  start: number,
  end: number,
  low: number,
  high: number,
  effect: (typeof MaskEffect)[keyof typeof MaskEffect] = MaskEffect.Add,
): SpectralShape {
  return {
    kind: 'rectangle',
    effect,
    range: { start: at(start), end: at(end) },
    band: { low, high },
  };
}

function mask(
  shapes: readonly [SpectralShape, ...SpectralShape[]],
  feather = NO_FEATHER,
): SpectralMask {
  return { shapes, feather };
}

function strokePoint(
  position: number,
  frequency: number,
  strength: number,
  time = 10,
  hertz = 100,
): StrokePoint {
  return { position: at(position), frequency, strength, radius: { time, frequency: hertz } };
}

describe('a spectral mask’s weight', () => {
  it('weighs a rectangle 1 inside it, edges included, and nothing outside without a feather', () => {
    const weights = new MaskWeights(mask([rectangle(100, 200, 1_000, 2_000)]));
    expect(weights.at(100, 1_000)).toBe(1);
    expect(weights.at(200, 2_000)).toBe(1);
    expect(weights.at(150, 1_500)).toBe(1);
    expect(weights.at(99, 1_500)).toBe(0);
    expect(weights.at(150, 2_000.5)).toBe(0);
  });

  it('fades a rectangle out across its feather, measured in feathers', () => {
    const weights = new MaskWeights(
      mask([rectangle(100, 200, 1_000, 2_000)], { time: 10, frequency: 100 }),
    );
    expect(weights.at(95, 1_500)).toBe(0.5);
    expect(weights.at(150, 2_025)).toBe(0.75);
    // Three tenths of a feather in time and four in frequency: half a feather away.
    expect(weights.at(97, 960)).toBeCloseTo(0.5, 15);
    expect(weights.at(90, 1_500)).toBe(0);
  });

  it('fills a concave polygon by the even-odd rule', () => {
    // A "U": its notch, between 40 and 60 above 500 Hz, is outside.
    const weights = new MaskWeights(
      mask([
        {
          kind: 'polygon',
          effect: MaskEffect.Add,
          points: [
            { position: at(0), frequency: 0 },
            { position: at(100), frequency: 0 },
            { position: at(100), frequency: 1_000 },
            { position: at(60), frequency: 1_000 },
            { position: at(60), frequency: 500 },
            { position: at(40), frequency: 500 },
            { position: at(40), frequency: 1_000 },
            { position: at(0), frequency: 1_000 },
          ],
        },
      ]),
    );
    expect(weights.at(20, 800)).toBe(1);
    expect(weights.at(50, 800)).toBe(0);
    expect(weights.at(50, 300)).toBe(1);
    expect(weights.at(80, 800)).toBe(1);
    expect(weights.at(120, 300)).toBe(0);
    // A "C": inside its mouth two edges lie above, an even count, so it is outside.
    const open = new MaskWeights(
      mask([
        {
          kind: 'polygon',
          effect: MaskEffect.Add,
          points: [
            { position: at(0), frequency: 0 },
            { position: at(100), frequency: 0 },
            { position: at(100), frequency: 300 },
            { position: at(40), frequency: 300 },
            { position: at(40), frequency: 700 },
            { position: at(100), frequency: 700 },
            { position: at(100), frequency: 1_000 },
            { position: at(0), frequency: 1_000 },
          ],
        },
      ]),
    );
    expect(open.at(50, 500)).toBe(0);
    expect(open.at(50, 800)).toBe(1);
    expect(open.at(20, 500)).toBe(1);
  });

  it('feathers a polygon by its distance to the nearest edge', () => {
    const weights = new MaskWeights(
      mask(
        [
          {
            kind: 'polygon',
            effect: MaskEffect.Add,
            points: [
              { position: at(0), frequency: 0 },
              { position: at(100), frequency: 0 },
              { position: at(100), frequency: 1_000 },
            ],
          },
        ],
        { time: 20, frequency: 200 },
      ),
    );
    // Straight above the vertical edge at 100, a quarter of a feather past it.
    expect(weights.at(105, 500)).toBe(0.75);
    expect(weights.at(50, 300)).toBe(1);
  });

  it('weighs a stroke its interpolated strength out to its hardness, then falls to its radius', () => {
    const weights = new MaskWeights(
      mask([
        {
          kind: 'stroke',
          effect: MaskEffect.Add,
          hardness: 0.5,
          points: [strokePoint(0, 1_000, 0.2), strokePoint(100, 1_000, 1)],
        },
      ]),
    );
    expect(weights.at(50, 1_000)).toBeCloseTo(0.6, 15);
    expect(weights.at(100, 1_040)).toBe(1);
    // Three quarters of the radius out: a half of the way from hardness to the edge.
    expect(weights.at(100, 1_075)).toBe(0.5);
    expect(weights.at(100, 1_100)).toBe(0);
    expect(weights.at(115, 1_000)).toBe(0);
  });

  it('takes a subtracting shape away from what the adding shapes cover', () => {
    const weights = new MaskWeights(
      mask([rectangle(0, 100, 0, 1_000), rectangle(40, 60, 0, 1_000, MaskEffect.Subtract)]),
    );
    expect(weights.at(20, 500)).toBe(1);
    expect(weights.at(50, 500)).toBe(0);
  });

  it('gives the same weight read point by point as read row by row', () => {
    let state = 7;
    const next = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const masks: SpectralMask[] = [];
    for (let run = 0; run < 20; run += 1) {
      masks.push(
        mask(
          [
            rectangle(
              Math.floor(next() * 50),
              50 + Math.floor(next() * 50),
              next() * 500,
              500 + next() * 500,
            ),
            {
              kind: 'polygon',
              effect: next() < 0.5 ? MaskEffect.Add : MaskEffect.Subtract,
              points: [
                { position: at(Math.floor(next() * 100)), frequency: next() * 1_000 },
                { position: at(Math.floor(next() * 100)), frequency: next() * 1_000 },
                { position: at(Math.floor(next() * 100)), frequency: next() * 1_000 },
                { position: at(Math.floor(next() * 100)), frequency: next() * 1_000 },
              ],
            },
            {
              kind: 'stroke',
              effect: MaskEffect.Add,
              hardness: next() * 0.9,
              points: [
                strokePoint(Math.floor(next() * 100), next() * 1_000, 0.1 + next() * 0.9, 8, 80),
                strokePoint(Math.floor(next() * 100), next() * 1_000, 0.1 + next() * 0.9, 12, 60),
              ],
            },
          ],
          run % 2 === 0 ? NO_FEATHER : { time: 1 + next() * 20, frequency: 1 + next() * 200 },
        ),
      );
    }
    const frequencies = Float64Array.from({ length: 257 }, (_, bin) => (bin * 1_200) / 256);
    const row = new Float64Array(frequencies.length);
    for (const [index, one] of masks.entries()) {
      const weights = new MaskWeights(one);
      for (let position = -10; position <= 110; position += 7) {
        weights.row(position, frequencies, row);
        frequencies.forEach((frequency, bin) => {
          expect(weights.at(position, frequency), `mask ${String(index)}`).toBe(row[bin]);
        });
      }
    }
  });
});
