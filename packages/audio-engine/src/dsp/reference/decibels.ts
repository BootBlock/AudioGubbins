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

/** The argument and result of each conversion, handed through the cores. */
const PARTS = new Float64Array(2);

/** The linear gain of `decibels`, identical to `decibels_to_gain` in `decibels.rs`. */
export function decibelsToGain(decibels: number): number {
  if (Number.isNaN(decibels)) return Number.NaN;
  const z = decibels * NEPERS_PER_DECIBEL_HIGH;
  if (z > LARGEST_ARGUMENT) return Number.POSITIVE_INFINITY;
  if (z < SMALLEST_ARGUMENT) return 0;
  PARTS[0] = z;
  PARTS[1] = productLow(decibels, NEPERS_PER_DECIBEL_HIGH, NEPERS_PER_DECIBEL_LOW, z);
  expOfSum(PARTS);
  return PARTS[0];
}

/** The decibels of a linear `gain`, identical to `gain_to_decibels` in `decibels.rs`. */
export function gainToDecibels(gain: number): number {
  if (!hasSeries(gain)) return specialLogarithm(gain);
  PARTS[0] = gain;
  lnParts(PARTS);
  return doubleProductRounded(
    PARTS[0],
    PARTS[1] ?? 0,
    DECIBELS_PER_NEPER_HIGH,
    DECIBELS_PER_NEPER_LOW,
  );
}
