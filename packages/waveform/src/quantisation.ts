/**
 * The 16-bit steps a peak is kept in.
 *
 * A step is 1/8192 of full scale, so the range is ±4 full scale, enough for the
 * overs a floating-point file can hold, and a step is finer than a pixel of any
 * lane at any amplitude zoom the editor offers. A minimum is rounded down and a
 * maximum up, so the envelope drawn is never narrower than the audio's
 * (ADR-0043); whether a bucket reached full scale is kept apart, not inferred
 * from a rounded value.
 */

/** Steps in one full scale. */
const STEPS_PER_FULL_SCALE = 8192;

const LOWEST = -32_768;
const HIGHEST = 32_767;

function clamped(steps: number): number {
  return Math.min(HIGHEST, Math.max(LOWEST, steps));
}

/** A minimum, in steps, rounded down. */
export function lowStep(value: number): number {
  return clamped(Math.floor(value * STEPS_PER_FULL_SCALE));
}

/** A maximum, in steps, rounded up. */
export function highStep(value: number): number {
  return clamped(Math.ceil(value * STEPS_PER_FULL_SCALE));
}

/** A root mean square, in steps, to the nearest. */
export function rmsStep(value: number): number {
  return clamped(Math.round(value * STEPS_PER_FULL_SCALE));
}

/** A value in steps, in full scale. */
export function fromSteps(steps: number): number {
  return steps / STEPS_PER_FULL_SCALE;
}
