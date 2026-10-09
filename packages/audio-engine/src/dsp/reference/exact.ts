/**
 * Error-free transformations: the exact rounding error of a sum or a product,
 * itself a double, as `exact.rs` finds it, operation for operation.
 *
 * JavaScript has no fused multiply-add, so a product's error is found by
 * Dekker's method, which needs only multiplication and addition (ADR-0032).
 *
 * V8 boxes a double passed to or returned from a call it does not inline: on
 * the audio thread, a heap number per call. The sums' errors and the split are
 * a few operations and no call, which V8 inlines wherever they run often, and
 * every caller calls them on each of its runs, so they answer as functions do.
 * The products' are too large to be sure of that, so each takes its operands in
 * a caller's `Float64Array` and leaves its answer in the first place, the
 * convention of every core of the reference path.
 */

/** `2²⁷ + 1`: Veltkamp's constant, which splits a significand into two halves. */
const SPLITTER = 134_217_729;

/** The high half of `a` by Veltkamp's split: `c − (c − a)`, `c = 134 217 729 · a`. */
function splitHigh(a: number): number {
  const c = SPLITTER * a;
  return c - (c - a);
}

/**
 * Replaces `[a, b, product]` in `operands` with `a · b − product`, exactly:
 * `(((ah·bh − product) + ah·bl) + al·bh) + al·bl`.
 */
export function productError(operands: Float64Array): void {
  const a = operands[0] ?? 0;
  const b = operands[1] ?? 0;
  const product = operands[2] ?? 0;
  const aHigh = splitHigh(a);
  const aLow = a - aHigh;
  const bHigh = splitHigh(b);
  const bLow = b - bHigh;
  operands[0] = aHigh * bHigh - product + aHigh * bLow + aLow * bHigh + aLow * bLow;
}

/** The rounding error of `sum = a + b`, for any magnitudes: Knuth's two-sum. */
export function sumError(a: number, b: number, sum: number): number {
  const bVirtual = sum - a;
  const aVirtual = sum - bVirtual;
  return a - aVirtual + (b - bVirtual);
}

/** The rounding error of `sum = a + b` where `|a| ≥ |b|` or `a` is zero: `b − (sum − a)`. */
export function fastSumError(a: number, b: number, sum: number): number {
  return b - (sum - a);
}

/**
 * Replaces `[a, bHigh, bLow, high]` in `operands` with the low part of
 * `a · (bHigh + bLow)`, whose high part is `high = a · bHigh`.
 */
export function productLow(operands: Float64Array): void {
  const a = operands[0] ?? 0;
  const bLow = operands[2] ?? 0;
  operands[2] = operands[3] ?? 0;
  productError(operands);
  operands[0] = (operands[0] ?? 0) + a * bLow;
}

/**
 * Replaces `[aHigh, aLow, bHigh, bLow]` in `operands` with
 * `(aHigh + aLow) · (bHigh + bLow)` rounded once:
 * `product + (error + (aHigh · bLow + aLow · bHigh))`.
 */
export function doubleProductRounded(operands: Float64Array): void {
  const aHigh = operands[0] ?? 0;
  const aLow = operands[1] ?? 0;
  const bHigh = operands[2] ?? 0;
  const bLow = operands[3] ?? 0;
  const product = aHigh * bHigh;
  operands[1] = bHigh;
  operands[2] = product;
  productError(operands);
  operands[0] = product + ((operands[0] ?? 0) + (aHigh * bLow + aLow * bHigh));
}
