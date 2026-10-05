/**
 * The cosine and tangent of an angle in turns, and the angle in turns of a
 * point, as `trigonometry.rs` computes them, operation for operation: each
 * argument reduced by subtractions Sterbenz's lemma makes exact, never a sine
 * of `turns + 1/4`, and each polynomial written as the crate's text
 * (ADR-0032).
 */

import { fastSumError, productError } from './exact.js';
import { sineOfReduced, sineOfTurns } from './primitives.js';

/** The coefficients of `cos(2πt)`, lowest power first; see `trigonometry.rs`. */
const COSINE_COEFFICIENTS: readonly number[] = [
  1, -19.739208802178716, 64.9393940226683, -85.45681720669373, 60.24464137187666,
  -26.4262567833744, 7.903536371318469, -1.714390711088672, 0.28200596845579123,
  -0.03638284114254567,
];

/** The coefficients of `atan(t) / 2π`, lowest power first; see `trigonometry.rs`. */
const ARCTANGENT_COEFFICIENTS: readonly number[] = [
  0.15915494309189535, -0.05305164769729845, 0.03183098861837907, -0.022736420441699334,
  0.017683882565766147, -0.014468631190172302, 0.012242687930145796, -0.010610329539459689,
  0.009362055475993843, -0.008376575952205017, 0.007578806813899778, -0.006919780134430232,
  0.006366197723675813, -0.005894627521922049, 0.0054881014859274255, -0.005134030422319204,
  0.004822877063390768, -0.004547284088339867, 0.0043014849484296035, -0.004080895976715265,
  0.0038818278802901303, -0.003701277746323147, 0.0035367765131532297, -0.0033862753849339434,
  0.0032480600630999047, -0.003120685158664614,
];

/** `1 / 2π`, the first arctangent coefficient, which scales the low part of the ratio. */
const INVERSE_TAU = ARCTANGENT_COEFFICIENTS[0] ?? 0;

/** `2⁵¹²` and `2⁻⁵¹²`, between which the arctangent works. */
const TWO_TO_512 = 1.3407807929942597e154;
const TWO_TO_MINUS_512 = 7.458340731200207e-155;

/** `cos(2π · turns)`, identical to `cosine_of_turns` in `trigonometry.rs`. */
export function cosineOfTurns(turns: number): number {
  const r = turns - Math.floor(turns);
  if (r < 0.125) return cosineOfReduced(r);
  if (r <= 0.375) return sineOfReduced(0.25 - r);
  if (r < 0.625) return -cosineOfReduced(r - 0.5);
  if (r <= 0.875) return sineOfReduced(r - 0.75);
  return cosineOfReduced(r - 1);
}

/** `tan(2π · turns)`: `sineOfTurns(turns) / cosineOfTurns(turns)`, as `tangent_of_turns`. */
export function tangentOfTurns(turns: number): number {
  return sineOfTurns(turns) / cosineOfTurns(turns);
}

/** `cos(2πt)` for `t` in `[−1/8, 1/8]`: Horner's rule in `t²`, highest coefficient first. */
function cosineOfReduced(t: number): number {
  const square = t * t;
  let sum = COSINE_COEFFICIENTS[9] ?? 0;
  for (let index = 8; index >= 0; index -= 1) {
    sum = sum * square + (COSINE_COEFFICIENTS[index] ?? 0);
  }
  return sum;
}

/**
 * The angle of `(x, y)` from the positive x-axis in turns, in `(−1/2, 1/2]`,
 * identical to `arctangent_turns` in `trigonometry.rs`, whose doc comment
 * states the special values and the order.
 */
export function arctangentTurns(y: number, x: number): number {
  if (Number.isNaN(y) || Number.isNaN(x)) return Number.NaN;
  const across = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  const b = Math.abs(y);
  let side: number;
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) {
    const firstQuadrant = b === 0 ? 0 : a === b ? 0.125 : Number.isFinite(b) ? 0 : 0.25;
    side = across ? 0.5 - firstQuadrant : firstQuadrant;
  } else {
    side = angleOfFinite(b, a, across);
  }
  const below = y < 0 || Object.is(y, -0);
  return below && side !== 0.5 ? -side : side;
}

/** The angle in `[0, 1/2]` of `(±a, b)`, finite, not both zero: `angle_of_finite`. */
function angleOfFinite(b: number, a: number, across: boolean): number {
  const fromYAxis = b > a;
  let big = fromYAxis ? b : a;
  let small = fromYAxis ? a : b;
  if (big >= TWO_TO_512) {
    big *= TWO_TO_MINUS_512;
    small *= TWO_TO_MINUS_512;
  } else if (big < TWO_TO_MINUS_512) {
    big *= TWO_TO_512;
    small *= TWO_TO_512;
  }
  let base: number;
  let inner: number;
  if (small + small <= big) {
    const t = small / big;
    const tb = t * big;
    const tLow = (small - tb - productError(t, big, tb)) / big;
    base = 0;
    inner = t * arctangentSeries(t * t) + tLow * INVERSE_TAU;
  } else {
    const n = small - big;
    const d = small + big;
    const dLow = fastSumError(big, small, d);
    const u = n / d;
    const ud = u * d;
    const uLow = (n - ud - productError(u, d, ud) - u * dLow) / d;
    base = 0.125;
    inner = u * arctangentSeries(u * u) + uLow * INVERSE_TAU;
  }
  if (fromYAxis) return across ? 0.25 + base + inner : 0.25 - base - inner;
  return across ? 0.5 - base - inner : base + inner;
}

/** `Σ cₙ zⁿ` over the arctangent coefficients, by Horner's rule, highest first. */
function arctangentSeries(z: number): number {
  let sum = ARCTANGENT_COEFFICIENTS[25] ?? 0;
  for (let index = 24; index >= 0; index -= 1) {
    sum = sum * z + (ARCTANGENT_COEFFICIENTS[index] ?? 0);
  }
  return sum;
}
