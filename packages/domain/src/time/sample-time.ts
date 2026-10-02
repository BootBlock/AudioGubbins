/**
 * Sample-accurate time.
 *
 * Audio positions are counts of samples, not seconds. Seconds are a floating
 * presentation of a position whose truth is an integer, and rounding one back
 * into the other repeatedly is how a splice lands a sample late. REQ-EXEC-216
 * also prohibits assuming sample rates match, so no value here carries an
 * implied rate: converting to or from seconds always takes the rate explicitly.
 */

import { failure, FailureKind, type DomainResult, fail, succeed } from '../result.js';

declare const SampleCountTag: unique symbol;
declare const SampleRateTag: unique symbol;

/**
 * A whole number of sample frames.
 *
 * A frame holds one sample for every channel, so a count of frames is
 * independent of the channel layout (REQ-ARCH-157).
 */
export type SampleCount = number & { readonly [SampleCountTag]: 'SampleCount' };

/** Sample frames per second. */
export type SampleRate = number & { readonly [SampleRateTag]: 'SampleRate' };

/**
 * The lowest and highest sample rates AudioGubbins accepts.
 *
 * The lower bound admits legacy game audio at 8 kHz. The upper bound admits 768
 * kHz, beyond any current capture hardware, so an implausible value is caught
 * at the boundary rather than producing a project that cannot be played.
 */
const MINIMUM_SAMPLE_RATE = 8_000;
const MAXIMUM_SAMPLE_RATE = 768_000;

/**
 * The largest sample count the domain accepts.
 *
 * `Number.MAX_SAFE_INTEGER` samples would be meaningless, and arithmetic near
 * it silently loses precision. This bound is roughly 776 years at 384 kHz,
 * which no project will reach, and it keeps every sum and difference exactly
 * representable.
 */
const MAXIMUM_SAMPLE_COUNT = 2 ** 53 - 1;

/** Builds a validated {@link SampleRate}. */
export function sampleRate(value: number): DomainResult<SampleRate> {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return fail(
      failure(
        'time.sample-rate-not-an-integer',
        FailureKind.Rejected,
        'A sample rate must be a whole number of frames per second.',
        {
          details: { value: String(value) },
        },
      ),
    );
  }
  if (value < MINIMUM_SAMPLE_RATE || value > MAXIMUM_SAMPLE_RATE) {
    return fail(
      failure(
        'time.sample-rate-out-of-range',
        FailureKind.Rejected,
        `A sample rate must be between ${String(MINIMUM_SAMPLE_RATE)} and ${String(MAXIMUM_SAMPLE_RATE)} Hz.`,
        {
          details: { value },
        },
      ),
    );
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a brand is minted here, after the checks above
  return succeed(value as SampleRate);
}

/** Builds a validated {@link SampleCount}. Negative counts are rejected. */
export function sampleCount(value: number): DomainResult<SampleCount> {
  if (!Number.isInteger(value)) {
    return fail(
      failure(
        'time.sample-count-not-an-integer',
        FailureKind.Rejected,
        'A sample count must be a whole number of frames.',
        {
          details: { value: String(value) },
        },
      ),
    );
  }
  if (value < 0) {
    return fail(
      failure(
        'time.sample-count-negative',
        FailureKind.Rejected,
        'A sample count cannot be negative.',
        {
          details: { value },
        },
      ),
    );
  }
  if (value > MAXIMUM_SAMPLE_COUNT) {
    return fail(
      failure(
        'time.sample-count-too-large',
        FailureKind.Rejected,
        'The sample count exceeds the range AudioGubbins can represent exactly.',
        {
          details: { value },
        },
      ),
    );
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a brand is minted here, after the checks above
  return succeed(value as SampleCount);
}

/** Zero sample frames. */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- zero is a sample count by definition
export const ZERO_SAMPLES = 0 as SampleCount;

/**
 * A count made by arithmetic on counts already checked, such as a segment cut
 * at a boundary inside it, which cannot leave the range `sampleCount` allows.
 * Never for a value from outside the domain: that is `sampleCount`'s.
 */
export function derivedSampleCount(value: number): SampleCount {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the operands were checked, and the arithmetic stays within their range
  return value as SampleCount;
}

/**
 * Adds two sample counts.
 *
 * Returns a failure rather than an inexact number if the sum leaves the range
 * where every integer is exactly representable.
 */
export function addSamples(left: SampleCount, right: SampleCount): DomainResult<SampleCount> {
  return sampleCount(left + right);
}

/**
 * Subtracts `right` from `left`.
 *
 * Fails if the result would be negative, because a negative duration or a
 * position before the start of the timeline is a domain error rather than a
 * value to clamp silently.
 */
export function subtractSamples(left: SampleCount, right: SampleCount): DomainResult<SampleCount> {
  return sampleCount(left - right);
}

/** Whether `inner` lies within `[start, start + length)`. */
export function containsSample(
  start: SampleCount,
  length: SampleCount,
  inner: SampleCount,
): boolean {
  return inner >= start && inner < start + length;
}

/**
 * Converts a sample count to seconds at an explicit rate.
 *
 * The result is a floating-point number and is suitable for display, for a
 * duration shown to a user, or for a control that thinks in seconds. It must
 * not be converted back and used as a position: round-trip through
 * {@link secondsToSamples} only where a single conversion is being made.
 */
export function samplesToSeconds(count: SampleCount, rate: SampleRate): number {
  return count / rate;
}

/**
 * Converts seconds to the nearest whole sample frame at an explicit rate.
 *
 * Rounds to nearest rather than truncating, so a value derived from a display
 * string does not drift one sample earlier on every pass.
 */
export function secondsToSamples(seconds: number, rate: SampleRate): DomainResult<SampleCount> {
  if (!Number.isFinite(seconds)) {
    return fail(
      failure(
        'time.seconds-not-finite',
        FailureKind.Rejected,
        'A time in seconds must be a finite number.',
        {
          details: { seconds: String(seconds) },
        },
      ),
    );
  }
  return sampleCount(Math.round(seconds * rate));
}

/**
 * Converts a sample count from one rate to another.
 *
 * This is a timeline conversion, not resampling: it answers where a position
 * lands, not what the audio sounds like. Actual resampling is owned by the
 * audio engine.
 */
export function convertSampleRate(
  count: SampleCount,
  from: SampleRate,
  to: SampleRate,
): DomainResult<SampleCount> {
  return sampleCount(Math.round((count * to) / from));
}
