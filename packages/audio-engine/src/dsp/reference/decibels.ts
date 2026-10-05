/**
 * Conversion between decibels and linear gain, as `decibels.rs` composes it:
 * each one composition of the exponential's or the logarithm's two-part core
 * with a two-part constant, rounded once, so 20 dB is a gain of exactly 10
 * and a gain of 10 exactly 20 dB (ADR-0032).
 */

import { doubleProductRounded, productLow } from './exact.js';
import { LARGEST_ARGUMENT, SMALLEST_ARGUMENT, expOfSum } from './exponential.js';
import { hasSeries, lnParts, specialLogarithm } from './logarithm.js';

/** `ln 10 / 20` as two parts: the natural logarithm of the gain of one decibel. */
const NEPERS_PER_DECIBEL_HIGH = 0.11512925464970228;
const NEPERS_PER_DECIBEL_LOW = 5.7995642524661006e-18;

/** `20 / ln 10` as two parts: the decibels of a gain of `e`. */
const DECIBELS_PER_NEPER_HIGH = 8.685889638065037;
const DECIBELS_PER_NEPER_LOW = -2.244252798067096e-16;

/**
 * Where the conversions' cores take their arguments and leave their answers. V8
 * boxes a double passed to or returned from a call it does not inline, a heap
 * number per sample on the audio thread, and whether it inlines a core this
 * size changes from one process to the next. So the cores return nothing and
 * take and give every double through here, and each conversion is a store, a
 * call and a read, small enough that V8 inlines it wherever it runs often. Each
 * core reads its arguments as it starts and writes its answer as it ends, so
 * one it calls may use the same places.
 */
const SLOT = new Float64Array(4);

/** The linear gain of `decibels`, identical to `decibels_to_gain` in `decibels.rs`. */
export function decibelsToGain(decibels: number): number {
  SLOT[0] = decibels;
  decibelsToGainInto();
  return SLOT[0];
}

/** The decibels of a linear `gain`, identical to `gain_to_decibels` in `decibels.rs`. */
export function gainToDecibels(gain: number): number {
  SLOT[0] = gain;
  gainToDecibelsInto();
  return SLOT[0];
}

/** Replaces a number of decibels in {@link SLOT} with its gain. */
function decibelsToGainInto(): void {
  const decibels = SLOT[0] ?? 0;
  // NaN alone is not itself. `Number.isNaN` would box its argument in code
  // V8's middle tier compiled, which code that runs rarely can stay in.
  if (decibels !== decibels) {
    SLOT[0] = Number.NaN;
    return;
  }
  const z = decibels * NEPERS_PER_DECIBEL_HIGH;
  if (z > LARGEST_ARGUMENT) {
    SLOT[0] = Number.POSITIVE_INFINITY;
    return;
  }
  if (z < SMALLEST_ARGUMENT) {
    SLOT[0] = 0;
    return;
  }
  SLOT[1] = NEPERS_PER_DECIBEL_HIGH;
  SLOT[2] = NEPERS_PER_DECIBEL_LOW;
  SLOT[3] = z;
  productLow(SLOT);
  SLOT[1] = SLOT[0] ?? 0;
  SLOT[0] = z;
  expOfSum(SLOT);
}

/** Replaces a gain in {@link SLOT} with its decibels. */
function gainToDecibelsInto(): void {
  if (!hasSeries(SLOT[0] ?? 0)) {
    specialLogarithm(SLOT);
    return;
  }
  lnParts(SLOT);
  SLOT[2] = DECIBELS_PER_NEPER_HIGH;
  SLOT[3] = DECIBELS_PER_NEPER_LOW;
  doubleProductRounded(SLOT);
}
