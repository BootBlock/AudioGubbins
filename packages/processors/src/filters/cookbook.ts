/**
 * The designs of Robert Bristow-Johnson's "Audio EQ Cookbook" for one
 * second-order section, as the sections here are made up to the hand-over to
 * the fitted designs (`biquad.ts`, `magnitude-fit.ts`), which design against
 * these where they take over.
 *
 * A design reads the angle of its frequency in turns through the canonical
 * cosine and sine, and the cookbook's `A`, `10^(dB/40)`, as the canonical
 * conversion of half the decibels, so a design is the same bits on every
 * machine (ADR-0032). Its six raw coefficients are each divided by `a0`, one
 * division apiece in the order b0, b1, b2, a1, a2, rather than multiplied by
 * a reciprocal, which would round twice.
 */

import { cosineOfTurns, decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';

import { BiquadShape, SectionSetting } from './biquad-shape.js';

/**
 * Where a design takes what it is made from and leaves its raw coefficients. V8
 * boxes a double passed to or returned from a call it does not inline, and a
 * running filter designs its sections again as its parameters move, on the
 * audio thread, so a design's steps return nothing and hand their doubles
 * through here: first `cos ω₀`, `α`, the cookbook's `A` (`10^(dB/40)`) and
 * `2·√A·α`, which the shelves alone take, then the raw b0, b1, b2, a0, a1 and
 * a2, before division by a0. Each step reads what it is given as it starts and
 * writes its answer as it ends.
 */
const SLOT = new Float64Array(6);

/** Replaces what a shape's design is made from in {@link SLOT} with its raw coefficients. */
type Design = () => void;

/** Each shape's raw coefficients, in the cookbook's order of terms. */
const DESIGNS: Readonly<Record<BiquadShape, Design>> = {
  [BiquadShape.Peaking]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    const a = SLOT[2] ?? 0;
    SLOT[0] = 1 + alpha * a;
    SLOT[1] = -2 * cosine;
    SLOT[2] = 1 - alpha * a;
    SLOT[3] = 1 + alpha / a;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha / a;
  },
  [BiquadShape.LowShelf]: () => {
    const cosine = SLOT[0] ?? 0;
    const a = SLOT[2] ?? 0;
    const shelf = SLOT[3] ?? 0;
    SLOT[0] = a * (a + 1 - (a - 1) * cosine + shelf);
    SLOT[1] = 2 * a * (a - 1 - (a + 1) * cosine);
    SLOT[2] = a * (a + 1 - (a - 1) * cosine - shelf);
    SLOT[3] = a + 1 + (a - 1) * cosine + shelf;
    SLOT[4] = -2 * (a - 1 + (a + 1) * cosine);
    SLOT[5] = a + 1 + (a - 1) * cosine - shelf;
  },
  [BiquadShape.HighShelf]: () => {
    const cosine = SLOT[0] ?? 0;
    const a = SLOT[2] ?? 0;
    const shelf = SLOT[3] ?? 0;
    SLOT[0] = a * (a + 1 + (a - 1) * cosine + shelf);
    SLOT[1] = -2 * a * (a - 1 + (a + 1) * cosine);
    SLOT[2] = a * (a + 1 + (a - 1) * cosine - shelf);
    SLOT[3] = a + 1 - (a - 1) * cosine + shelf;
    SLOT[4] = 2 * (a - 1 - (a + 1) * cosine);
    SLOT[5] = a + 1 - (a - 1) * cosine - shelf;
  },
  [BiquadShape.LowPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = (1 - cosine) / 2;
    SLOT[1] = 1 - cosine;
    SLOT[2] = (1 - cosine) / 2;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.HighPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = (1 + cosine) / 2;
    SLOT[1] = -(1 + cosine);
    SLOT[2] = (1 + cosine) / 2;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.BandPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = alpha;
    SLOT[1] = 0;
    SLOT[2] = -alpha;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.Notch]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = 1;
    SLOT[1] = -2 * cosine;
    SLOT[2] = 1;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.AllPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = 1 - alpha;
    SLOT[1] = -2 * cosine;
    SLOT[2] = 1 + alpha;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
};

/**
 * The shelves' slope, S = 1, the steepest that does not overshoot, which
 * makes their `α` `sin(ω₀)/2 · √2` whatever their gain.
 */
const SHELF_ALPHA_FACTOR = Math.SQRT2 / 2;

/**
 * Writes the cookbook's coefficients of `shape` at `rate`, at the frequency
 * in Hz, gain in dB and Q in `settings`, below half the rate, into `into`
 * from `at`: b0, b1, b2, a1 and a2, a0 being 1. The gain is read by the
 * peaking and shelf shapes alone, and the Q by every shape but the shelves.
 */
export function designCookbook(
  shape: BiquadShape,
  rate: number,
  settings: Float64Array,
  into: Float64Array,
  at: number,
): void {
  const frequency = settings[SectionSetting.Frequency] ?? 0;
  const turns = frequency / rate;
  const sine = sineOfTurns(turns);
  const shelved = shape === BiquadShape.LowShelf || shape === BiquadShape.HighShelf;
  const alpha = shelved
    ? sine * SHELF_ALPHA_FACTOR
    : sine / (2 * (settings[SectionSetting.Q] ?? 0));
  const amplitude = decibelsToGain((settings[SectionSetting.Gain] ?? 0) / 2);
  SLOT[0] = cosineOfTurns(turns);
  SLOT[1] = alpha;
  SLOT[2] = amplitude;
  SLOT[3] = shelved ? 2 * Math.sqrt(amplitude) * alpha : 0;
  DESIGNS[shape]();
  const a0 = SLOT[3];
  into[at] = SLOT[0] / a0;
  into[at + 1] = SLOT[1] / a0;
  into[at + 2] = SLOT[2] / a0;
  into[at + 3] = (SLOT[4] ?? 0) / a0;
  into[at + 4] = (SLOT[5] ?? 0) / a0;
}
