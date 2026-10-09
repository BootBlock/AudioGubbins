/**
 * What the magnitude fit (`magnitude-fit.ts`) is asked for: the grid of the
 * band it is fitted over, the squared magnitude of a section's analogue
 * prototype at each point, at the true frequency, the cookbook's analogue
 * forms of each shape, and the zeros the prototype holds that the fit keeps
 * exactly, as a factor of the numerator in `x`, the cosine of the angle.
 * Arithmetic and the canonical cosine and decibel conversion, in arrays made
 * once, so it is the same bits everywhere and allocates nothing.
 */

import { cosineOfTurns, decibelsToGain } from '@audiogubbins/audio-engine';

import { BiquadShape, SectionSetting } from './biquad-shape.js';

/** The points of the grid the fit is made over. */
export const GRID = 96;

/**
 * Each grid point's fraction of half the rate: half uniform and half denser
 * towards half the rate, where a resonance just above it is drawn.
 */
const GRID_FRACTIONS = Float64Array.from({ length: GRID }, (_, k) => {
  const t = k / (GRID - 1);
  return 0.5 * t + 0.5 * (1 - (1 - t) * (1 - t));
});

/** `cos ω` at each grid point, by the canonical cosine. */
export const GRID_X = GRID_FRACTIONS.map((fraction) => cosineOfTurns(fraction / 2));

/** The zeros a fit keeps where the prototype has them, as a factor of the numerator in `x`. */
export const Zero = {
  /** None: the numerator is fitted whole. */
  None: 0,
  /** `(1 − x)²`, a high-pass's double zero at DC. */
  DoubleAtDc: 1,
  /** `1 − x`, a band-pass's zero at DC. */
  AtDc: 2,
  /** `(x − x₀)²`, a notch's double zero (see {@link notchZero}). */
  Notch: 3,
} as const;

export type Zero = (typeof Zero)[keyof typeof Zero];

/** The analogue numerator and denominator of the squared magnitude, each `p₀ + p₁u + p₂u²`. */
const PARTS = new Float64Array(6);

/** At each grid point: the analogue numerator less its kept zeros, the denominator, the kept zeros' value and the asked-for ratio. */
export const NUMERATOR = new Float64Array(GRID);
export const DENOMINATOR = new Float64Array(GRID);
const ZEROS = new Float64Array(GRID);
export const ASKED = new Float64Array(GRID);
/** Whether a grid point takes part: not one where a kept zero is. */
export const USED = new Uint8Array(GRID);

/** The numerator's coefficients, of `z⁻¹`, for each kind of kept zero. */
export const ZERO_TERMS = new Float64Array(3);

/** Scalars of what is asked for: the frequency's ratio to the rate, the numerator's floor and a notch's zero. */
export const PROTOTYPE = new Float64Array(3);
const RATIO = 0;
export const NUMERATOR_FLOOR = 1;
const ZERO_AT = 2;

/** Writes the analogue prototype of `shape` into {@link PARTS}: the cookbook's analogue forms. */
function analogueParts(shape: BiquadShape, settings: Float64Array): void {
  const a = decibelsToGain((settings[SectionSetting.Gain] ?? 0) / 2);
  const q = settings[SectionSetting.Q] ?? 1;
  const inverseQ = 1 / (q * q);
  const squared = a * a;
  // (1 − u)² + c·u is 1 + (c − 2)·u + u².
  PARTS[0] = 1;
  PARTS[2] = 1;
  PARTS[3] = 1;
  PARTS[4] = inverseQ - 2;
  PARTS[5] = 1;
  switch (shape) {
    case BiquadShape.Peaking:
      PARTS[1] = squared * inverseQ - 2;
      PARTS[4] = inverseQ / squared - 2;
      return;
    case BiquadShape.LowShelf:
      // A²((A − u)² + 2Au) over (1 − Au)² + 2Au, the slope S = 1.
      PARTS[0] = squared * squared;
      PARTS[1] = 0;
      PARTS[2] = squared;
      PARTS[3] = 1;
      PARTS[4] = 0;
      PARTS[5] = squared;
      return;
    case BiquadShape.HighShelf:
      PARTS[0] = squared;
      PARTS[1] = 0;
      PARTS[2] = squared * squared;
      PARTS[3] = squared;
      PARTS[4] = 0;
      PARTS[5] = 1;
      return;
    case BiquadShape.HighPass:
      PARTS[0] = 0;
      PARTS[1] = 0;
      return;
    case BiquadShape.BandPass:
      PARTS[0] = 0;
      PARTS[1] = inverseQ;
      PARTS[2] = 0;
      return;
    case BiquadShape.Notch:
      PARTS[1] = -2;
      return;
    default:
      // The low-pass, whose poles an all-pass takes too.
      PARTS[1] = 0;
      PARTS[2] = 0;
  }
}

/** Writes the kept zeros' value at each grid point (see {@link Zero}) to {@link ZEROS}. */
function sampleZeros(kind: Zero): void {
  const at = PROTOTYPE[ZERO_AT] ?? 0;
  for (let k = 0; k < GRID; k += 1) {
    const x = GRID_X[k] ?? 0;
    switch (kind) {
      case Zero.DoubleAtDc:
        ZEROS[k] = (1 - x) * (1 - x);
        break;
      case Zero.AtDc:
        ZEROS[k] = 1 - x;
        break;
      case Zero.Notch:
        ZEROS[k] = (x - at) * (x - at);
        break;
      default:
        ZEROS[k] = 1;
    }
  }
}

/**
 * Samples the prototype over the grid, the frequency's ratio to the rate in
 * {@link PROTOTYPE} `[RATIO]`: `u` at a point is the square of its frequency
 * over the section's.
 */
export function sampleGrid(kind: Zero): void {
  const ratio = PROTOTYPE[RATIO] ?? 1;
  sampleZeros(kind);
  let most = 0;
  for (let k = 0; k < GRID; k += 1) most = Math.max(most, ZEROS[k] ?? 0);
  let largest = 0;
  for (let k = 0; k < GRID; k += 1) {
    const zero = ZEROS[k] ?? 0;
    USED[k] = zero > most * 1e-9 ? 1 : 0;
    const over = (GRID_FRACTIONS[k] ?? 0) / (2 * ratio);
    const u = over * over;
    const numerator = (PARTS[0] ?? 0) + u * ((PARTS[1] ?? 0) + u * (PARTS[2] ?? 0));
    NUMERATOR[k] = USED[k] === 1 ? numerator / zero : 0;
    DENOMINATOR[k] = (PARTS[3] ?? 0) + u * ((PARTS[4] ?? 0) + u * (PARTS[5] ?? 0));
    if (USED[k] === 1) largest = Math.max(largest, NUMERATOR[k] ?? 0);
  }
  // A floor for the numerator where the prototype's own zero is near, so no
  // point asks for nothing at all.
  const floor = largest * 1e-9;
  PROTOTYPE[NUMERATOR_FLOOR] = floor;
  for (let k = 0; k < GRID; k += 1) {
    ASKED[k] = Math.max(NUMERATOR[k] ?? 0, floor) / (DENOMINATOR[k] ?? 1);
  }
}

/** How many of the numerator's coefficients a fit with `kind`'s zeros keeps. */
export function numeratorTerms(kind: Zero): number {
  switch (kind) {
    case Zero.DoubleAtDc:
    case Zero.Notch:
      return 1;
    case Zero.AtDc:
      return 2;
    default:
      return 3;
  }
}

/** Writes the kept zeros' factor in `z⁻¹` (see {@link Zero}) to {@link ZERO_TERMS}. */
export function zeroTerms(kind: Zero): void {
  const at = PROTOTYPE[ZERO_AT] ?? 0;
  ZERO_TERMS[2] = 0;
  switch (kind) {
    case Zero.DoubleAtDc:
      // (1 − z⁻¹)²/2, whose magnitude squared is (1 − x)².
      ZERO_TERMS[0] = 0.5;
      ZERO_TERMS[1] = -1;
      ZERO_TERMS[2] = 0.5;
      return;
    case Zero.AtDc:
      ZERO_TERMS[0] = Math.SQRT1_2;
      ZERO_TERMS[1] = -Math.SQRT1_2;
      return;
    case Zero.Notch:
      notchTerms(at);
      return;
    default:
      ZERO_TERMS[0] = 1;
      ZERO_TERMS[1] = 0;
  }
}

/**
 * Writes to {@link ZERO_TERMS} a factor in `z⁻¹` whose magnitude squared is
 * `(x − x₀)²`: two zeros on the circle at the angle whose cosine `x₀` is,
 * `(1 − 2x₀z⁻¹ + z⁻²)/2`, inside the band; outside it, below `−1`, a double
 * zero `ρ = x₀ + √(x₀² − 1)` inside the circle, `(1 − ρz⁻¹)²/2|ρ|`. The two
 * are `(1 + z⁻¹)²/2` at `−1`.
 */
function notchTerms(at: number): void {
  if (at >= -1) {
    ZERO_TERMS[0] = 0.5;
    ZERO_TERMS[1] = -at;
    ZERO_TERMS[2] = 0.5;
    return;
  }
  const rho = at + Math.sqrt(at * at - 1);
  const scale = 1 / (2 * Math.abs(rho));
  ZERO_TERMS[0] = scale;
  ZERO_TERMS[1] = -2 * rho * scale;
  ZERO_TERMS[2] = rho * rho * scale;
}

/**
 * Writes to {@link PROTOTYPE} `[ZERO_AT]` where a notch's numerator,
 * `c(x − x₀)²`, has its double zero, for its frequency's ratio to the rate:
 * inside the band, on the circle at its frequency, the prototype's own zero;
 * above half the rate, outside the band, where the numerator's value at half
 * the rate over its value at DC is the prototype's, `(1 − (π/ω₀)²)²`. Both
 * give `−1` at half the rate, so the zero moves on without a step as the
 * frequency crosses it, where a zero kept inside the band and given up above
 * it changed the fit's form, and its response with a step.
 */
function notchZero(): void {
  const ratio = PROTOTYPE[RATIO] ?? 0;
  if (ratio <= 0.5) {
    PROTOTYPE[ZERO_AT] = cosineOfTurns(ratio);
    return;
  }
  const over = 0.5 / ratio;
  const share = 1 - over * over;
  PROTOTYPE[ZERO_AT] = -(1 + share) / (1 - share);
}

/**
 * The zeros a fit of `shape` keeps: a high-pass's and a band-pass's at DC,
 * and a notch's where {@link notchZero} places it.
 */
function keptZeros(shape: BiquadShape): Zero {
  switch (shape) {
    case BiquadShape.HighPass:
      return Zero.DoubleAtDc;
    case BiquadShape.BandPass:
      return Zero.AtDc;
    case BiquadShape.Notch:
      notchZero();
      return Zero.Notch;
    default:
      return Zero.None;
  }
}

/**
 * Asks for `shape` at `rate`, from the frequency, gain and Q in `settings`:
 * its analogue prototype, and the zeros of it a fit keeps, which it answers.
 */
export function askFor(shape: BiquadShape, rate: number, settings: Float64Array): Zero {
  PROTOTYPE[RATIO] = (settings[SectionSetting.Frequency] ?? 0) / rate;
  analogueParts(shape, settings);
  return keptZeros(shape);
}
