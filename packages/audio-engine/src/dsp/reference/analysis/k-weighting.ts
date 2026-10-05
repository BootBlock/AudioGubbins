/**
 * The K-weighting of ITU-R BS.1770-4, designed for any rate by the bilinear
 * transform as `k_weighting.rs` designs it, coefficient for coefficient, and
 * run in the transposed direct form II it states (ADR-0032).
 */

import { decibelsToGain } from '../decibels.js';
import { pow } from '../power.js';
import { tangentOfTurns } from '../trigonometry.js';

/** The shelf's corner frequency, gain in decibels, quality and band exponent; see `k_weighting.rs`. */
const SHELF_FREQUENCY = 1681.974450955533;
const SHELF_GAIN = 3.999843853973347;
const SHELF_QUALITY = 0.7071752369554196;
const SHELF_BAND_EXPONENT = 0.4996667741545416;

/** The high-pass filter's corner frequency and quality. */
const HIGH_PASS_FREQUENCY = 38.13547087602444;
const HIGH_PASS_QUALITY = 0.5003270373238773;

/** A biquad's coefficients, its `a0` divided out. */
export interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/**
 * The next output for `input`, with the state at `state[at]` and
 * `state[at + 1]`: `y = b0 · x + s₁`, `s₁ = (b1 · x − a1 · y) + s₂`,
 * `s₂ = b2 · x − a2 · y`; `Biquad::run`.
 */
export function runBiquad(stage: Biquad, state: Float64Array, at: number, input: number): number {
  const output = stage.b0 * input + (state[at] ?? 0);
  state[at] = stage.b1 * input - stage.a1 * output + (state[at + 1] ?? 0);
  state[at + 1] = stage.b2 * input - stage.a2 * output;
  return output;
}

/** `K / Q` and `K · K` into `parts`, with `K = tan(π · frequency / rate)`. */
function prototype(frequency: number, quality: number, rate: number, parts: Float64Array): void {
  const k = tangentOfTurns(frequency / (2 * rate));
  parts[0] = k / quality;
  parts[1] = k * k;
}

/** The two stages of K-weighting at `sampleRate`, the shelf first; `k_weighting`. */
export function kWeighting(sampleRate: number): readonly [Biquad, Biquad] {
  const parts = new Float64Array(2);
  prototype(SHELF_FREQUENCY, SHELF_QUALITY, sampleRate, parts);
  let kq = parts[0] ?? 0;
  let k2 = parts[1] ?? 0;
  const vh = decibelsToGain(SHELF_GAIN);
  const vb = pow(vh, SHELF_BAND_EXPONENT);
  let a0 = 1 + kq + k2;
  const shelf: Biquad = {
    b0: (vh + vb * kq + k2) / a0,
    b1: (2 * (k2 - vh)) / a0,
    b2: (vh - vb * kq + k2) / a0,
    a1: (2 * (k2 - 1)) / a0,
    a2: (1 - kq + k2) / a0,
  };
  prototype(HIGH_PASS_FREQUENCY, HIGH_PASS_QUALITY, sampleRate, parts);
  kq = parts[0] ?? 0;
  k2 = parts[1] ?? 0;
  a0 = 1 + kq + k2;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k2 - 1)) / a0,
    a2: (1 - kq + k2) / a0,
  };
  return [shelf, highPass];
}
