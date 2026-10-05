/**
 * A number raised to a power, as `power.rs` computes it: `e^(y · ln x)` with
 * `ln x` and `y · ln x` each carried as two doubles, and the special cases
 * decided in the crate's order (ADR-0032). A negative base is NaN for every
 * exponent but zero: the processors raise only numbers at or above zero.
 */

import { productLow } from './exact.js';
import { LARGEST_ARGUMENT, SMALLEST_ARGUMENT, expOfSum } from './exponential.js';
import { lnParts } from './logarithm.js';

/** The base and its logarithm, then the exponent's argument and the result, handed through the cores. */
const PARTS = new Float64Array(2);

/** `xʸ` for `x ≥ 0`, identical to `pow` in `power.rs`, whose doc comment states the cases. */
export function pow(x: number, y: number): number {
  if (y === 0 || x === 1) return 1;
  if (Number.isNaN(x) || Number.isNaN(y) || x < 0) return Number.NaN;
  if (x === 0) return y > 0 ? 0 : Number.POSITIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return y > 0 ? Number.POSITIVE_INFINITY : 0;
  if (!Number.isFinite(y)) return x > 1 === y > 0 ? Number.POSITIVE_INFINITY : 0;
  PARTS[0] = x;
  lnParts(PARTS);
  const log = PARTS[0];
  const z = y * log;
  if (z > LARGEST_ARGUMENT) return Number.POSITIVE_INFINITY;
  if (z < SMALLEST_ARGUMENT) return 0;
  PARTS[1] = productLow(y, log, PARTS[1] ?? 0, z);
  PARTS[0] = z;
  expOfSum(PARTS);
  return PARTS[0];
}
