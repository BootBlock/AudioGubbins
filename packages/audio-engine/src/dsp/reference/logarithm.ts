/**
 * The natural, binary and decimal logarithms, as `logarithm.rs` computes them,
 * operation for operation: `x = 2ᵉ · m` from the bits, `m` in `[√½, √2]`, and
 * `ln m = 2 · atanh((m − 1)/(m + 1))` carried as two doubles, accurate to about
 * 2⁻⁶³, so the power can multiply it by a large exponent (ADR-0032).
 */

import { doubleProductRounded, fastSumError, productError, sumError } from './exact.js';
import { LN2_HIGH, LN2_LOW } from './exponential.js';

/** `2/(2n + 1)` for `n` from 2 to 12, lowest first; see `logarithm.rs`. */
const SERIES: readonly number[] = [
  0.4, 0.2857142857142857, 0.2222222222222222, 0.18181818181818182, 0.15384615384615385,
  0.13333333333333333, 0.11764705882352941, 0.10526315789473684, 0.09523809523809523,
  0.08695652173913043, 0.08,
];

/** `2/3`, `1 / ln 2` and `1 / ln 10`, each as two parts. */
const TWO_THIRDS_HIGH = 0.6666666666666666;
const TWO_THIRDS_LOW = 3.700743415417188e-17;
const LOG2_E_LOW = 2.0355273740931033e-17;
const LOG10_E_LOW = 1.098319650216765e-17;

/** `2⁵⁴`, which lifts a subnormal into the normal range exactly. */
const TWO_TO_54 = 18_014_398_509_481_984;

/** The eight bytes a double is taken apart in, made once. */
const BITS = new DataView(new ArrayBuffer(8));

/**
 * Where the logarithms' cores take their arguments and leave their answers. V8
 * boxes a double passed to or returned from a call it does not inline, a heap
 * number per sample on the audio thread, and whether it inlines a core this
 * size changes from one process to the next. So the cores return nothing and
 * take and give every double through here or a caller's `Float64Array`, and
 * each logarithm is a store, a call and a read, small enough that V8 inlines it
 * wherever it runs often. Each core reads its arguments as it starts and writes
 * its answer as it ends, so one it calls may use the same places.
 */
const SLOT = new Float64Array(4);

/** `ln x`, identical to `ln` in `logarithm.rs`. */
export function ln(x: number): number {
  SLOT[0] = x;
  lnInto();
  return SLOT[0];
}

/** `log₂ x`: the logarithm's two parts times `1 / ln 2`'s, rounded once. */
export function log2(x: number): number {
  SLOT[0] = x;
  log2Into();
  return SLOT[0];
}

/** `log₁₀ x`: the logarithm's two parts times `1 / ln 10`'s, rounded once. */
export function log10(x: number): number {
  SLOT[0] = x;
  log10Into();
  return SLOT[0];
}

/**
 * Replaces `x` in {@link SLOT} with `ln x`, as `[hi, lo]` where the series
 * gives it, and answers whether it did.
 */
function lnInto(): boolean {
  if (hasSeries(SLOT[0] ?? 0)) {
    lnParts(SLOT);
    return true;
  }
  specialLogarithm(SLOT);
  return false;
}

/** Replaces `x` in {@link SLOT} with `log₂ x`. */
function log2Into(): void {
  if (!lnInto()) return;
  SLOT[2] = Math.LOG2E;
  SLOT[3] = LOG2_E_LOW;
  doubleProductRounded(SLOT);
}

/** Replaces `x` in {@link SLOT} with `log₁₀ x`. */
function log10Into(): void {
  if (!lnInto()) return;
  SLOT[2] = Math.LOG10E;
  SLOT[3] = LOG10_E_LOW;
  doubleProductRounded(SLOT);
}

/**
 * Whether the series gives the logarithm of `x`: whether it is finite and
 * above zero. A boolean, so the test costs nothing: a `number | undefined`
 * answer tested on every call made V8 allocate a number a call.
 */
export function hasSeries(x: number): boolean {
  return x > 0 && x < Number.POSITIVE_INFINITY;
}

/**
 * Replaces `x` in `parts[0]`, where {@link hasSeries} is false, with every
 * logarithm's answer: NaN for NaN and below zero, `−∞` at either zero, `+∞`
 * at `+∞`.
 */
export function specialLogarithm(parts: Float64Array): void {
  const x = parts[0] ?? 0;
  if (x === 0) parts[0] = Number.NEGATIVE_INFINITY;
  else if (x !== Number.POSITIVE_INFINITY) parts[0] = Number.NaN;
}

/**
 * Replaces the finite `x` above zero in `parts[0]` with `ln x` as
 * `[hi, lo]`: the crate's `ln_parts`, whose doc comment states the order.
 */
export function lnParts(parts: Float64Array): void {
  const x = parts[0] ?? 0;
  BITS.setFloat64(0, x);
  let lift = 0;
  if (BITS.getUint32(0) >>> 20 === 0) {
    BITS.setFloat64(0, x * TWO_TO_54);
    lift = -54;
  }
  const word = BITS.getUint32(0);
  let exponent = (word >>> 20) - 1023 + lift;
  BITS.setUint32(0, (word & 0x000f_ffff) | 0x3ff0_0000);
  let m = BITS.getFloat64(0);
  if (m > Math.SQRT2) {
    m *= 0.5;
    exponent += 1;
  }
  const f = m - 1;

  const d = 2 + f;
  const dLow = fastSumError(2, f, d);
  const s = f / d;
  const sd = s * d;
  SLOT[0] = s;
  SLOT[1] = d;
  SLOT[2] = sd;
  productError(SLOT);
  const sLow = (f - sd - SLOT[0] - s * dLow) / d;

  const z = s * s;
  SLOT[0] = s;
  SLOT[1] = s;
  SLOT[2] = z;
  productError(SLOT);
  const zLow = SLOT[0] + (s + s) * sLow;
  const c = s * z;
  SLOT[0] = s;
  SLOT[1] = z;
  SLOT[2] = c;
  productError(SLOT);
  const cLow = SLOT[0] + (s * zLow + sLow * z);

  let t = SERIES[10] ?? 0;
  for (let index = 9; index >= 0; index -= 1) {
    t = t * z + (SERIES[index] ?? 0);
  }
  const u = z * t;
  const q = TWO_THIRDS_HIGH + u;
  const qLow = fastSumError(TWO_THIRDS_HIGH, u, q) + TWO_THIRDS_LOW;

  const p = c * q;
  SLOT[0] = c;
  SLOT[1] = q;
  SLOT[2] = p;
  productError(SLOT);
  const pLow = SLOT[0] + (c * qLow + cLow * q);

  const twoS = s + s;
  const g = twoS + p;
  const gLow = fastSumError(twoS, p, g) + (sLow + sLow + pLow);

  const h = exponent * LN2_HIGH;
  const y = h + g;
  const yLow = sumError(h, g, y) + (gLow + exponent * LN2_LOW);
  const high = y + yLow;
  parts[0] = high;
  parts[1] = fastSumError(y, yLow, high);
}
