/**
 * Error-free transformations: the exact rounding error of a sum or a product,
 * itself a double, as `exact.rs` finds it, operation for operation.
 *
 * JavaScript has no fused multiply-add, so a product's error is found by
 * Dekker's method, which needs only multiplication and addition (ADR-0032).
 * Each answers one number, the error, so a caller on the audio thread
 * allocates no pair per call.
 */

/** `2²⁷ + 1`: Veltkamp's constant, which splits a significand into two halves. */
const SPLITTER = 134_217_729;

/** The high half of `a` by Veltkamp's split: `c − (c − a)`, `c = 134 217 729 · a`. */
function splitHigh(a: number): number {
  const c = SPLITTER * a;
  return c - (c - a);
}

/** `a · b − product`, exactly: `(((ah·bh − product) + ah·bl) + al·bh) + al·bl`. */
export function productError(a: number, b: number, product: number): number {
  const aHigh = splitHigh(a);
  const aLow = a - aHigh;
  const bHigh = splitHigh(b);
  const bLow = b - bHigh;
  return aHigh * bHigh - product + aHigh * bLow + aLow * bHigh + aLow * bLow;
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

/** The low part of `a · (bHigh + bLow)` whose high part is `high = a · bHigh`. */
export function productLow(a: number, bHigh: number, bLow: number, high: number): number {
  return productError(a, bHigh, high) + a * bLow;
}

/**
 * `(aHigh + aLow) · (bHigh + bLow)` rounded once:
 * `product + (error + (aHigh · bLow + aLow · bHigh))`.
 */
export function doubleProductRounded(
  aHigh: number,
  aLow: number,
  bHigh: number,
  bLow: number,
): number {
  const product = aHigh * bHigh;
  return product + (productError(aHigh, bHigh, product) + (aHigh * bLow + aLow * bHigh));
}
