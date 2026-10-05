import { describe, expect, it } from 'vitest';

import { BiquadCascade, BiquadShape, butterworthQ, poleDecayFrames } from './biquad.js';
import {
  analyticMagnitude,
  binMagnitudes,
  cascadeImpulse,
  decibels,
  lastAudibleFrame,
} from '../testing/filter-measures.js';

const RATE = 48_000;

/** The shelves' slope S. */
const SHELF_SLOPE = 1;

/** The coefficients of one section of `shape`, designed by the cascade. */
function designed(shape: BiquadShape, frequency: number, gain: number, q: number): Float64Array {
  const cascade = new BiquadCascade(1, 1);
  cascade.design(0, shape, frequency, RATE, gain, q);
  return cascade.coefficients;
}

/**
 * The cookbook's coefficients written out again from its text with the
 * platform's own functions, divided by a0: a second derivation the canonical
 * design is held to.
 */
function cookbook(shape: BiquadShape, f: number, gain: number, q: number): number[] {
  const w = (2 * Math.PI * f) / RATE;
  const [cos, sin, a] = [Math.cos(w), Math.sin(w), Math.pow(10, gain / 40)];
  const shelf = shape === BiquadShape.LowShelf || shape === BiquadShape.HighShelf;
  const alpha = shelf
    ? (sin / 2) * Math.sqrt((a + 1 / a) * (1 / SHELF_SLOPE - 1) + 2)
    : sin / (2 * q);
  const root = 2 * Math.sqrt(a) * alpha;
  const terms: Record<BiquadShape, number[]> = {
    [BiquadShape.Peaking]: [
      1 + alpha * a,
      -2 * cos,
      1 - alpha * a,
      1 + alpha / a,
      -2 * cos,
      1 - alpha / a,
    ],
    [BiquadShape.LowShelf]: [
      a * (a + 1 - (a - 1) * cos + root),
      2 * a * (a - 1 - (a + 1) * cos),
      a * (a + 1 - (a - 1) * cos - root),
      a + 1 + (a - 1) * cos + root,
      -2 * (a - 1 + (a + 1) * cos),
      a + 1 + (a - 1) * cos - root,
    ],
    [BiquadShape.HighShelf]: [
      a * (a + 1 + (a - 1) * cos + root),
      -2 * a * (a - 1 + (a + 1) * cos),
      a * (a + 1 + (a - 1) * cos - root),
      a + 1 - (a - 1) * cos + root,
      2 * (a - 1 - (a + 1) * cos),
      a + 1 - (a - 1) * cos - root,
    ],
    [BiquadShape.LowPass]: [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
    [BiquadShape.HighPass]: [
      (1 + cos) / 2,
      -(1 + cos),
      (1 + cos) / 2,
      1 + alpha,
      -2 * cos,
      1 - alpha,
    ],
    [BiquadShape.BandPass]: [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha],
    [BiquadShape.Notch]: [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha],
    [BiquadShape.AllPass]: [1 - alpha, -2 * cos, 1 + alpha, 1 + alpha, -2 * cos, 1 - alpha],
  };
  const [b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0] = terms[shape];
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

const SHAPES = Object.values(BiquadShape);

/** Settings every shape is held to: frequency, gain and Q. */
const SETTINGS: readonly (readonly [number, number, number])[] = [
  [1_000, 6, 1],
  [250, -12, 0.5],
  [8_000, 18, 4],
];

/** The magnitude of one section at `frequency` Hz. */
function magnitudeAt(coefficients: Float64Array, frequency: number): number {
  return analyticMagnitude(coefficients, frequency / RATE);
}

describe('the cookbook sections', () => {
  it("are the cookbook's designs, within the rounding of a second derivation", () => {
    for (const shape of SHAPES) {
      for (const [frequency, gain, q] of SETTINGS) {
        const ours = designed(shape, frequency, gain, q);
        const theirs = cookbook(shape, frequency, gain, q);
        theirs.forEach((value, index) => {
          expect(Math.abs((ours[index] ?? 0) - value)).toBeLessThan(1e-12);
        });
      }
    }
  });

  it('run as the response their coefficients give, measured by the FFT within 1e-9', () => {
    const size = 16_384;
    // Bins near 250 Hz, 1 kHz, 4 kHz and 12 kHz, each taken at its exact frequency.
    const bins = [85, 341, 1_365, 4_096];
    for (const shape of SHAPES) {
      for (const [frequency, gain, q] of SETTINGS) {
        const cascade = new BiquadCascade(1, 1);
        cascade.design(0, shape, frequency, RATE, gain, q);
        const measured = binMagnitudes(cascadeImpulse(cascade, size));
        for (const bin of bins) {
          const expected = analyticMagnitude(cascade.coefficients, bin / size);
          expect(Math.abs((measured[bin] ?? 0) - expected)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('give a bell the gain asked for at its centre, within 0.01 dB', () => {
    for (const gain of [-24, -6, 3, 12, 24]) {
      const bell = designed(BiquadShape.Peaking, 1_000, gain, 1.5);
      expect(Math.abs(decibels(magnitudeAt(bell, 1_000)) - gain)).toBeLessThan(0.01);
    }
  });

  it('give a shelf its gain at the far end and half of it at its frequency', () => {
    const low = designed(BiquadShape.LowShelf, 200, 9, 1);
    const high = designed(BiquadShape.HighShelf, 5_000, -9, 1);
    expect(Math.abs(decibels(analyticMagnitude(low, 0)) - 9)).toBeLessThan(0.01);
    expect(Math.abs(decibels(magnitudeAt(low, 200)) - 4.5)).toBeLessThan(0.01);
    expect(Math.abs(decibels(analyticMagnitude(high, 0.5)) + 9)).toBeLessThan(0.01);
    expect(Math.abs(decibels(magnitudeAt(high, 5_000)) + 4.5)).toBeLessThan(0.01);
  });

  it('give a notch no output at its centre, a band-pass 0 dB there and an all-pass unity', () => {
    expect(decibels(magnitudeAt(designed(BiquadShape.Notch, 50, 0, 30), 50))).toBeLessThan(-120);
    const band = designed(BiquadShape.BandPass, 3_000, 0, 2);
    expect(Math.abs(decibels(magnitudeAt(band, 3_000)))).toBeLessThan(0.01);
    const all = designed(BiquadShape.AllPass, 700, 0, 0.8);
    for (const frequency of [20, 700, 5_000, 23_000]) {
      expect(Math.abs(magnitudeAt(all, frequency) - 1)).toBeLessThan(1e-12);
    }
  });

  it('are designed no higher than 0.49 of the rate, where they stay stable', () => {
    const above = designed(BiquadShape.LowPass, 40_000, 0, 0.7);
    expect([...above]).toEqual([...designed(BiquadShape.LowPass, 0.49 * RATE, 0, 0.7)]);
    // Stable: the poles' product, a2, is inside the unit circle.
    expect(Math.abs(above[4] ?? 1)).toBeLessThan(1);
  });
});

describe('the Butterworth cascades', () => {
  it("take each section's Q from its pole pair's angle", () => {
    for (const order of [2, 4, 6, 8]) {
      for (let section = 0; section < order / 2; section += 1) {
        const angle = ((2 * section + 1) * Math.PI) / (2 * order);
        expect(butterworthQ(order, section)).toBeCloseTo(1 / (2 * Math.cos(angle)), 14);
      }
    }
  });

  it('are 3 dB down at the cutoff within 0.05 dB and flat an octave and more below it', () => {
    for (const shape of [BiquadShape.LowPass, BiquadShape.HighPass]) {
      for (const order of [2, 4, 6, 8]) {
        const cascade = new BiquadCascade(1, order / 2);
        for (let section = 0; section < order / 2; section += 1) {
          cascade.design(section, shape, 2_000, RATE, 0, butterworthQ(order, section));
        }
        const atCutoff = decibels(magnitudeAt(cascade.coefficients, 2_000));
        expect(Math.abs(atCutoff + 3.0103)).toBeLessThan(0.05);
        const passband = shape === BiquadShape.LowPass ? 500 : 8_000;
        expect(Math.abs(decibels(magnitudeAt(cascade.coefficients, passband)))).toBeLessThan(0.05);
      }
    }
  });
});

describe('the decay a lead-in is estimated from', () => {
  it('covers the frames a ringing section takes to fall by 120 dB, and not twice them', () => {
    for (const [frequency, q] of [
      [1_000, 10],
      [100, 2],
      [5_000, 0.3],
    ] as const) {
      const cascade = new BiquadCascade(1, 1);
      cascade.design(0, BiquadShape.BandPass, frequency, RATE, 0, q);
      const response = cascadeImpulse(cascade, 65_536);
      const last = lastAudibleFrame(response);
      const estimate = poleDecayFrames(frequency, q, RATE);
      expect(estimate).toBeGreaterThanOrEqual(last);
      expect(estimate).toBeLessThan(2 * last);
    }
  });
});
