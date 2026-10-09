import { describe, expect, it } from 'vitest';

import { BiquadCascade, butterworthQ, poleDecayFrames, sectionDecayFrames } from './biquad.js';
import { BiquadShape } from './biquad-shape.js';
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

  it("keep the cookbook's design to 0.45 of the rate, where the hand-over to the fitted designs starts", () => {
    for (const shape of SHAPES) {
      const ours = designed(shape, 0.45 * RATE, 6, 2);
      cookbook(shape, 0.45 * RATE, 6, 2).forEach((value, index) => {
        expect(Math.abs((ours[index] ?? 0) - value)).toBeLessThan(1e-12);
      });
    }
  });
});

/**
 * The squared magnitude of the analogue prototype of `shape` at `frequency`
 * Hz, for a section at `centre` Hz, from the cookbook's analogue transfer
 * functions written out again with the platform's functions: `H(s)` at
 * `s = j·frequency/centre`, the shelves at the slope S = 1.
 */
function analogueSquared(
  shape: BiquadShape,
  centre: number,
  frequency: number,
  gain: number,
  q: number,
): number {
  const w = frequency / centre;
  const a = Math.pow(10, gain / 40);
  // |c + b·s + a·s²|² at s = jw, for s² + s/Q + 1 and its kin.
  const quadratic = (c: number, b: number, s2: number) => (c - s2 * w * w) ** 2 + (b * w) ** 2;
  const shelfQ = Math.SQRT1_2;
  switch (shape) {
    case BiquadShape.Peaking:
      return quadratic(1, a / q, 1) / quadratic(1, 1 / (a * q), 1);
    case BiquadShape.LowShelf:
      return (
        (a * a * quadratic(a, Math.sqrt(a) / shelfQ, 1)) / quadratic(1, Math.sqrt(a) / shelfQ, a)
      );
    case BiquadShape.HighShelf:
      return (
        (a * a * quadratic(1, Math.sqrt(a) / shelfQ, a)) / quadratic(a, Math.sqrt(a) / shelfQ, 1)
      );
    case BiquadShape.LowPass:
      return 1 / quadratic(1, 1 / q, 1);
    case BiquadShape.HighPass:
      return w ** 4 / quadratic(1, 1 / q, 1);
    case BiquadShape.BandPass:
      return (w / q) ** 2 / quadratic(1, 1 / q, 1);
    case BiquadShape.Notch:
      return quadratic(1, 0, 1) / quadratic(1, 1 / q, 1);
    case BiquadShape.AllPass:
      return 1;
  }
}

/**
 * The largest difference in dB between a section's magnitude and its analogue
 * prototype's, over 1,024 frequencies from DC to `upTo` of half the rate,
 * where the prototype is within 40 dB of its peak over the band.
 */
function largestError(
  coefficients: Float64Array,
  shape: BiquadShape,
  centre: number,
  rate: number,
  gain: number,
  q: number,
  upTo = 1,
): number {
  const points = 1_024;
  const half = rate / 2;
  let peak = 0;
  for (let k = 0; k <= points; k += 1) {
    peak = Math.max(peak, analogueSquared(shape, centre, (k / points) * half, gain, q));
  }
  let largest = 0;
  for (let k = 0; k <= points * upTo; k += 1) {
    const frequency = (k / points) * half;
    const asked = analogueSquared(shape, centre, frequency, gain, q);
    if (asked < peak * 1e-4) continue;
    const made = analyticMagnitude(coefficients, frequency / rate) ** 2;
    largest = Math.max(largest, Math.abs(10 * Math.log10(made / asked)));
  }
  return largest;
}

/**
 * The largest difference in dB between two sections' responses below 0.9 of
 * half the rate, where both are within 40 dB of the larger peak.
 */
function responseStep(one: Float64Array, other: Float64Array): number {
  const points = 900;
  let peak = 0;
  for (let k = 0; k <= points; k += 1) {
    const turns = k / 2_000;
    peak = Math.max(peak, analyticMagnitude(one, turns), analyticMagnitude(other, turns));
  }
  let largest = 0;
  for (let k = 0; k <= points; k += 1) {
    const turns = k / 2_000;
    const a = analyticMagnitude(one, turns);
    const b = analyticMagnitude(other, turns);
    if (a < peak * 0.01 || b < peak * 0.01) continue;
    largest = Math.max(largest, Math.abs(decibels(a / b)));
  }
  return largest;
}

/** The larger radius of a section's poles, `z² + a1·z + a2`. */
function poleRadius(coefficients: Float64Array): number {
  const a1 = coefficients[3] ?? 0;
  const a2 = coefficients[4] ?? 0;
  const discriminant = a1 * a1 - 4 * a2;
  return discriminant < 0 ? Math.sqrt(a2) : (Math.abs(a1) + Math.sqrt(discriminant)) / 2;
}

/** One section of `shape` designed at `rate`. */
function designedAt(
  shape: BiquadShape,
  frequency: number,
  rate: number,
  gain: number,
  q: number,
): Float64Array {
  const cascade = new BiquadCascade(1, 1);
  cascade.design(0, shape, frequency, rate, gain, q);
  return cascade.coefficients;
}

describe('the sections above 0.49 of the rate', { timeout: 120_000 }, () => {
  // Each was moved to 0.49 of the rate at full gain before: the bell's
  // centre at 15.68 kHz, its whole band too loud.
  it.each([
    ['a +12 dB bell at 20 kHz', 0.2, BiquadShape.Peaking, 20_000, 12, 1],
    ['a high shelf of +6 dB at 18 kHz', 0.2, BiquadShape.HighShelf, 18_000, 6, 1],
    ['a high-pass at 18 kHz', 0.6, BiquadShape.HighPass, 18_000, 0, Math.SQRT1_2],
    ['a low-pass at 16.5 kHz', 0.3, BiquadShape.LowPass, 16_500, 0, 2],
  ] as const)(
    'give %s at 32 kHz its analogue magnitude up to half the rate, within %s dB',
    (_case, tolerance, shape, frequency, gain, q) => {
      const coefficients = designedAt(shape, frequency, 32_000, gain, q);
      expect(largestError(coefficients, shape, frequency, 32_000, gain, q)).toBeLessThan(tolerance);
      expect(poleRadius(coefficients)).toBeLessThan(1);
    },
  );

  it('stay stable and near the analogue magnitude across every shape, frequency, gain and Q', () => {
    // At 8 kHz, where the frequencies the parameters reach run to 2.5 times
    // the rate. Every digital section is flat at half the rate where the
    // analogue response still slopes, so the fit is held closer below 90 %
    // of it than at it, where a narrow resonance just above it is drawn.
    const rate = 8_000;
    for (const shape of SHAPES) {
      for (const ratio of [0.4901, 0.495, 0.5, 0.55, 0.625, 0.8, 1.2, 2.5]) {
        for (const q of [0.1, Math.SQRT1_2, 4, 24]) {
          for (const gain of [-24, 0, 24]) {
            const centre = ratio * rate;
            const coefficients = designedAt(shape, centre, rate, gain, q);
            const at = `${shape} at ${String(ratio)} of the rate, Q ${String(q)}, ${String(gain)} dB`;
            expect([...coefficients].every(Number.isFinite), at).toBe(true);
            expect(poleRadius(coefficients), at).toBeLessThan(1);
            const below = largestError(coefficients, shape, centre, rate, gain, q, 0.9);
            const whole = largestError(coefficients, shape, centre, rate, gain, q);
            // A notch's zero is placed by a rule continuous through half
            // the rate, not fitted, which costs it a little more.
            expect(below, at).toBeLessThan(shape === BiquadShape.Notch ? 2.5 : 1.5);
            expect(whole, at).toBeLessThan(8);
          }
        }
      }
    }
  });

  it('move without a step as their frequency crosses the hand-over, at 44.1 and 48 kHz', () => {
    // Below 0.45 of the rate the cookbook's design, above 0.49 the fitted
    // one, and between, coefficients moved from one to the other; a switch
    // from the one to the other at 0.49 moved a response by up to 40 dB at
    // once. Each design is held to the one a millionth of the rate above it,
    // below 0.9 of half the rate, where both are within 40 dB of their peak,
    // and every edge the designs change form at is straddled.
    for (const rate of [44_100, 48_000]) {
      for (const shape of SHAPES) {
        for (const q of [0.1, Math.SQRT1_2, 4, 24]) {
          for (const gain of [-24, 6, 24]) {
            const design = (fraction: number) => designedAt(shape, fraction * rate, rate, gain, q);
            const fractions = [0.45, 0.49, 0.5];
            for (let fraction = 0.44; fraction <= 0.56; fraction += 0.0025)
              fractions.push(fraction);
            for (const fraction of fractions) {
              const at = `${shape} at ${fraction.toFixed(4)} of ${String(rate)} Hz, Q ${String(q)}, ${String(gain)} dB`;
              expect(responseStep(design(fraction), design(fraction + 1e-6)), at).toBeLessThan(0.1);
            }
          }
        }
      }
    }
  });

  it('give an all-pass unity magnitude, its poles the fitted low-pass’s', () => {
    for (const q of [0.5, 4, 24]) {
      const all = designedAt(BiquadShape.AllPass, 18_000, 32_000, 0, q);
      const low = designedAt(BiquadShape.LowPass, 18_000, 32_000, 0, q);
      expect([all[3], all[4]]).toEqual([low[3], low[4]]);
      for (const frequency of [20, 1_000, 9_000, 15_999]) {
        expect(Math.abs(analyticMagnitude(all, frequency / 32_000) - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it('give a notch inside the band no output at its frequency', () => {
    const notch = designedAt(BiquadShape.Notch, 15_800, 32_000, 0, 2);
    expect(decibels(analyticMagnitude(notch, 15_800 / 32_000))).toBeLessThan(-100);
  });

  it('estimate a lead-in that covers the decay of their own poles, and not twice it', () => {
    for (const [shape, frequency, gain, q] of [
      [BiquadShape.LowPass, 15_700, 0, 24],
      [BiquadShape.Peaking, 15_700, 24, 16],
      [BiquadShape.BandPass, 20_000, 0, 4],
    ] as const) {
      const cascade = new BiquadCascade(1, 1);
      cascade.design(0, shape, frequency, 32_000, gain, q);
      const last = lastAudibleFrame(cascadeImpulse(cascade, 65_536));
      const estimate = sectionDecayFrames(shape, frequency, 32_000, gain, q);
      expect(estimate).toBeGreaterThanOrEqual(last);
      expect(estimate).toBeLessThan(2 * last + 8);
    }
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
