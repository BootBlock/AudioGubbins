/**
 * The sample rates and counts a fixture is built with, checked by the domain.
 *
 * A fixture is data a test trusts, so it is made the way the application makes
 * the same values: through the domain's own constructors, which refuse a
 * negative length or an impossible rate. Writing a number into the type instead
 * would build a fixture on a value the domain would have refused, and the test
 * using it would be testing something that cannot happen.
 */

import { sampleCount, sampleRate, type SampleCount, type SampleRate } from '@audiogubbins/domain';

/** A sample rate the domain accepts, or a loud failure naming the one it did not. */
export function fixtureSampleRate(hertz: number): SampleRate {
  const result = sampleRate(hertz);
  if (!result.ok) {
    throw new Error(`The fixture sample rate ${String(hertz)} was rejected by the domain.`);
  }
  return result.value;
}

/** A sample count the domain accepts, or a loud failure naming the one it did not. */
export function fixtureSampleCount(frames: number): SampleCount {
  const result = sampleCount(frames);
  if (!result.ok) {
    throw new Error(`The fixture sample count ${String(frames)} was rejected by the domain.`);
  }
  return result.value;
}
