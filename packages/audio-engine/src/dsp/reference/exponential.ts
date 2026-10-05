/**
 * The natural exponential, as `exponential.rs` computes it, operation for
 * operation: Cody and Waite's reduction by a split `ln 2`, the Taylor series
 * to the 14th power, and a scaling by `2ᵏ` built from bits. The constants are
 * the same text as the crate's, so they parse to the same doubles (ADR-0032).
 *
 * The core takes its argument and gives its result through a `Float64Array`
 * rather than as arguments and a return value: V8 boxes a double passed to or
 * returned from a call it does not inline, which on the audio thread is an
 * allocation per sample, and the core is too large to be sure of inlining.
 */

/** `ln 2`'s high 42 bits, so `k · LN2_HIGH` is exact for any `|k| < 2¹¹`. */
export const LN2_HIGH = 0.6931471805598903;

/** `ln 2 − LN2_HIGH`, rounded. */
export const LN2_LOW = 5.497923018708371e-14;

/** Past it the exponential overflows, so it is infinity at once. */
export const LARGEST_ARGUMENT = 709.8;

/** Below it the exponential rounds to zero, so it is zero at once. */
export const SMALLEST_ARGUMENT = -745.2;

/** `1/n!` for `n` from 2 to 14, lowest first; see `exponential.rs`. */
const TAYLOR: readonly number[] = [
  0.5, 0.16666666666666666, 0.041666666666666664, 0.008333333333333333, 0.001388888888888889,
  0.0001984126984126984, 2.48015873015873e-5, 2.7557319223985893e-6, 2.755731922398589e-7,
  2.505210838544172e-8, 2.08767569878681e-9, 1.6059043836821613e-10, 1.1470745597729725e-11,
];

/** The eight bytes `powerOfTwo` builds a double in, made once. */
const BITS = new DataView(new ArrayBuffer(8));

/** The argument and result of `exp`, handed through the core. */
const ARGUMENT = new Float64Array(2);

/** `eˣ`, identical to `exp` in `exponential.rs`. */
export function exp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  ARGUMENT[0] = x;
  ARGUMENT[1] = 0;
  expOfSum(ARGUMENT);
  return ARGUMENT[0];
}

/**
 * Replaces the argument `[high, low]` in `parts`, `high` not NaN, with
 * `e^(high + low)` in `parts[0]`: the crate's `exp_of_sum`, whose doc comment
 * states the order.
 */
export function expOfSum(parts: Float64Array): void {
  const high = parts[0] ?? 0;
  const low = parts[1] ?? 0;
  if (high > LARGEST_ARGUMENT) {
    parts[0] = Number.POSITIVE_INFINITY;
    return;
  }
  if (high < SMALLEST_ARGUMENT) {
    parts[0] = 0;
    return;
  }
  const k = Math.floor(high * Math.LOG2E + 0.5);
  const h = high - k * LN2_HIGH;
  const l = k * LN2_LOW - low;
  const r = h - l;
  const lost = h - r - l;
  let q = TAYLOR[12] ?? 0;
  for (let index = 11; index >= 0; index -= 1) {
    q = q * r + (TAYLOR[index] ?? 0);
  }
  const p = 1 + (r + (r * r * q + lost * (1 + r)));
  parts[0] = scaleByPowerOfTwo(p, k);
}

/** `value · 2ⁿ` rounded once, as `scale_by_power_of_two` in `exponential.rs`. */
function scaleByPowerOfTwo(value: number, n: number): number {
  if (n > 1023) return value * powerOfTwo(1023) * powerOfTwo(n - 1023);
  if (n < -1022) return value * powerOfTwo(n + 1000) * powerOfTwo(-1000);
  return value * powerOfTwo(n);
}

/** `2ⁿ` for `n` in `[−1022, 1023]`, from its bits. */
function powerOfTwo(n: number): number {
  BITS.setUint32(0, (n + 1023) << 20);
  BITS.setUint32(4, 0);
  return BITS.getFloat64(0);
}
