/**
 * A number raised to a power, as `power.rs` computes it: `e^(y · ln x)` with
 * `ln x` and `y · ln x` each carried as two doubles, and the special cases
 * decided in the crate's order (ADR-0032). A negative base is NaN for every
 * exponent but zero: the processors raise only numbers at or above zero.
 */

import { productLow } from './exact.js';
import { LARGEST_ARGUMENT, SMALLEST_ARGUMENT, expOfSum } from './exponential.js';
import { lnParts } from './logarithm.js';

/**
 * Where the power's core takes its arguments and leaves its answer. V8 boxes
 * a double passed to or returned from a call it does not inline, a heap
 * number per sample on the audio thread, and whether it inlines a core this
 * size changes from one process to the next. So the core returns nothing and
 * takes and gives every double through here, and {@link pow} is two stores, a
 * call and a read. Each core reads its arguments as it starts and writes its
 * answer as it ends, so one it calls may use the same places.
 */
const SLOT = new Float64Array(4);

/** `xʸ` for `x ≥ 0`, identical to `pow` in `power.rs`, whose doc comment states the cases. */
export function pow(x: number, y: number): number {
  SLOT[0] = x;
  SLOT[1] = y;
  powInto();
  return SLOT[0];
}

/** Replaces `[x, y]` in {@link SLOT} with `xʸ`. */
function powInto(): void {
  const x = SLOT[0] ?? 0;
  const y = SLOT[1] ?? 0;
  if (y === 0 || x === 1) {
    SLOT[0] = 1;
    return;
  }
  // NaN alone is not itself, and `y − y` is 0 only for finite `y`.
  // `Number.isNaN` and `Number.isFinite` would box their arguments in code
  // V8's middle tier compiled, which code that runs rarely can stay in.
  if (x !== x || y !== y || x < 0) {
    SLOT[0] = Number.NaN;
    return;
  }
  if (x === 0) {
    SLOT[0] = y > 0 ? 0 : Number.POSITIVE_INFINITY;
    return;
  }
  if (x === Number.POSITIVE_INFINITY) {
    SLOT[0] = y > 0 ? Number.POSITIVE_INFINITY : 0;
    return;
  }
  if (y - y !== 0) {
    SLOT[0] = x > 1 === y > 0 ? Number.POSITIVE_INFINITY : 0;
    return;
  }
  lnParts(SLOT);
  const log = SLOT[0] ?? 0;
  const logLow = SLOT[1] ?? 0;
  const z = y * log;
  if (z > LARGEST_ARGUMENT) {
    SLOT[0] = Number.POSITIVE_INFINITY;
    return;
  }
  if (z < SMALLEST_ARGUMENT) {
    SLOT[0] = 0;
    return;
  }
  SLOT[0] = y;
  SLOT[1] = log;
  SLOT[2] = logLow;
  SLOT[3] = z;
  productLow(SLOT);
  SLOT[1] = SLOT[0];
  SLOT[0] = z;
  expOfSum(SLOT);
}
