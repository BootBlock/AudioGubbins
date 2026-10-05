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

/**
 * Where the trigonometry's cores take their arguments and leave their
 * answers. V8 boxes a double passed to or returned from a call it does not
 * inline, a heap number per sample on the audio thread, and whether it
 * inlines a core this size changes from one process to the next. So the
 * cores return nothing and take and give every double through here or a
 * caller's `Float64Array`, and each function only stores its arguments here,
 * calls its core and reads the answer, which keeps the cosine and tangent
 * small enough that V8 inlines them wherever they run often. Each core reads
 * its arguments as it starts and writes its answer as it ends, so one it
 * calls may use the same places.
 */
const SLOT = new Float64Array(3);

/** `cos(2π · turns)`, identical to `cosine_of_turns` in `trigonometry.rs`. */
export function cosineOfTurns(turns: number): number {
  SLOT[0] = turns;
  cosineInto();
  return SLOT[0];
}

/** `tan(2π · turns)`: `sineOfTurns(turns) / cosineOfTurns(turns)`, as `tangent_of_turns`. */
export function tangentOfTurns(turns: number): number {
  SLOT[0] = turns;
  tangentInto();
  return SLOT[0];
}

/**
 * The angle of `(x, y)` from the positive x-axis in turns, in `(−1/2, 1/2]`,
 * identical to `arctangent_turns` in `trigonometry.rs`, whose doc comment
 * states the special values and the order.
 */
export function arctangentTurns(y: number, x: number): number {
  SLOT[0] = y;
  SLOT[1] = x;
  arctangentInto();
  return SLOT[0];
}

/** Replaces a number of turns in {@link SLOT} with its cosine. */
function cosineInto(): void {
  const turns = SLOT[0] ?? 0;
  const r = turns - Math.floor(turns);
  if (r < 0.125) {
    SLOT[0] = r;
    cosineOfReduced();
  } else if (r <= 0.375) {
    SLOT[0] = 0.25 - r;
    sineOfReduced(SLOT);
  } else if (r < 0.625) {
    SLOT[0] = r - 0.5;
    cosineOfReduced();
    SLOT[0] = -SLOT[0];
  } else if (r <= 0.875) {
    SLOT[0] = r - 0.75;
    sineOfReduced(SLOT);
  } else {
    SLOT[0] = r - 1;
    cosineOfReduced();
  }
}

/** Replaces a number of turns in {@link SLOT} with its tangent. */
function tangentInto(): void {
  const sine = sineOfTurns(SLOT[0] ?? 0);
  cosineInto();
  SLOT[0] = sine / (SLOT[0] ?? 0);
}

/**
 * Replaces `t` in `[−1/8, 1/8]` in {@link SLOT} with `cos(2πt)`: Horner's rule
 * in `t²`, highest coefficient first.
 */
function cosineOfReduced(): void {
  const t = SLOT[0] ?? 0;
  const square = t * t;
  let sum = COSINE_COEFFICIENTS[9] ?? 0;
  for (let index = 8; index >= 0; index -= 1) {
    sum = sum * square + (COSINE_COEFFICIENTS[index] ?? 0);
  }
  SLOT[0] = sum;
}

/** Replaces `[y, x]` in {@link SLOT} with the angle {@link arctangentTurns} answers. */
function arctangentInto(): void {
  const y = SLOT[0] ?? 0;
  const x = SLOT[1] ?? 0;
  // NaN alone is not itself, `v − v` is 0 only for finite `v`, and −0 alone
  // of the zeros has a negative reciprocal. `Number.isNaN`, `Number.isFinite`
  // and `Object.is` would box their arguments in code V8's middle tier
  // compiled, which code that runs rarely can stay in.
  if (y !== y || x !== x) {
    SLOT[0] = Number.NaN;
    return;
  }
  const across = x < 0 || (x === 0 && 1 / x < 0);
  const a = Math.abs(x);
  const b = Math.abs(y);
  let side: number;
  if (a - a !== 0 || b - b !== 0 || (a === 0 && b === 0)) {
    const firstQuadrant = b === 0 ? 0 : a === b ? 0.125 : b - b === 0 ? 0 : 0.25;
    side = across ? 0.5 - firstQuadrant : firstQuadrant;
  } else {
    SLOT[0] = b;
    SLOT[1] = a;
    angleOfFinite(across);
    side = SLOT[0];
  }
  const below = y < 0 || (y === 0 && 1 / y < 0);
  SLOT[0] = below && side !== 0.5 ? -side : side;
}

/**
 * Replaces `[b, a]` in {@link SLOT}, finite and not both zero, with the angle
 * in `[0, 1/2]` of `(±a, b)`: `angle_of_finite`.
 */
function angleOfFinite(across: boolean): void {
  const b = SLOT[0] ?? 0;
  const a = SLOT[1] ?? 0;
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
  // Worked out before the branch, not in it: V8 inlines no call that runs
  // rarely, and a number crossing a call it has not inlined is boxed.
  const d = small + big;
  const dLow = fastSumError(big, small, d);
  let base: number;
  let inner: number;
  if (small + small <= big) {
    const t = small / big;
    const tb = t * big;
    SLOT[0] = t;
    SLOT[1] = big;
    SLOT[2] = tb;
    productError(SLOT);
    const tLow = (small - tb - SLOT[0]) / big;
    base = 0;
    SLOT[0] = t * t;
    arctangentSeries();
    inner = t * SLOT[0] + tLow * INVERSE_TAU;
  } else {
    const n = small - big;
    const u = n / d;
    const ud = u * d;
    SLOT[0] = u;
    SLOT[1] = d;
    SLOT[2] = ud;
    productError(SLOT);
    const uLow = (n - ud - SLOT[0] - u * dLow) / d;
    base = 0.125;
    SLOT[0] = u * u;
    arctangentSeries();
    inner = u * SLOT[0] + uLow * INVERSE_TAU;
  }
  if (fromYAxis) SLOT[0] = across ? 0.25 + base + inner : 0.25 - base - inner;
  else SLOT[0] = across ? 0.5 - base - inner : base + inner;
}

/**
 * Replaces `z` in {@link SLOT} with `Σ cₙ zⁿ` over the arctangent
 * coefficients, by Horner's rule, highest first.
 */
function arctangentSeries(): void {
  const z = SLOT[0] ?? 0;
  let sum = ARCTANGENT_COEFFICIENTS[25] ?? 0;
  for (let index = 24; index >= 0; index -= 1) {
    sum = sum * z + (ARCTANGENT_COEFFICIENTS[index] ?? 0);
  }
  SLOT[0] = sum;
}
