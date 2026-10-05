/**
 * What every kernel does at its edges so one bad sample cannot ruin a render
 * (REQ-AUDIO-146).
 *
 * A NaN or an infinity reaching a recursive filter or an envelope would stay
 * in its state for ever, so every kernel reads its input through
 * `finiteSample`, which hears such a sample as silence; the fault is the
 * source's, and the processor goes on. A value that has decayed into the
 * subnormal range is a thousand times slower to compute on most processors
 * and inaudible, so feedback state is passed through `flushSubnormal`. Both
 * are basic comparisons, the same on every machine, so neither touches the
 * canonical answer of any input that is finite and normal.
 */

/** Below this magnitude a recursive state is silence: 2⁻¹⁰⁰, far under any audible level. */
const SMALLEST_STATE = 7.888609052210118e-31;

/** The sample, or zero where it is a NaN or an infinity. */
export function finiteSample(sample: number): number {
  // `x - x` is 0 for every finite x and NaN otherwise, a test of one subtraction.
  return sample - sample === 0 ? sample : 0;
}

/** The state, or zero where it has decayed below `SMALLEST_STATE`. */
export function flushSubnormal(state: number): number {
  return state > SMALLEST_STATE || state < -SMALLEST_STATE ? state : 0;
}
