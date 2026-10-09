/**
 * The loopback calibration's analysis: the round trip's delay, found by
 * correlating what was captured with the burst that was played (`REQ-REC-095`,
 * ADR-0070).
 *
 * Capture and playback share the context's clock, so a capture that begins at
 * the frame the burst was scheduled to play holds the burst again after the
 * output's latency, the air and the input's latency: the round trip. The lag at
 * which the capture and the burst correlate most is that delay. The search is
 * direct and bounded by the longest round trip it looks for, so its cost is
 * known: the burst's length times the lags searched, all of it arithmetic over
 * the arrays given, nothing allocated per lag.
 *
 * A measurement is refused unless its peak stands clear of the correlation
 * around it. Without a loopback, a microphone hears the room and the burst
 * faintly or not at all, and the largest lag of noise is still a largest lag:
 * taking it would store a round trip that is a guess.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { CALIBRATION_SIGNAL_LENGTH, calibrationSequence } from './calibration-signal.js';

/**
 * The longest round trip searched for. Wired interfaces take a few to a few
 * tens of milliseconds, and Bluetooth paths a few hundred; a second covers the
 * slowest with room, and bounds the search to a second of lags.
 */
const MAXIMUM_ROUND_TRIP_SECONDS = 1;

/**
 * How far the peak must stand above the correlation's root mean square away
 * from it. Over a second of lags at 48 kHz, the largest of uncorrelated noise
 * is about four and a half times its root mean square, so twice that leaves a
 * clear margin, while a burst heard back at all stands tens of times above.
 */
export const MINIMUM_PEAK_RATIO = 9;

/**
 * The lags either side of the peak left out of the floor it is measured
 * against: the speaker's and microphone's own response spreads the peak over a
 * few milliseconds, and that spread is the peak, not the floor.
 */
const PEAK_SPREAD_SECONDS = 0.005;

/** A round trip found by the loopback. */
export interface LoopbackMeasurement {
  /** The delay from the frame the burst was played at to the frame it was captured at. */
  readonly roundTrip: SampleCount;

  /** How far the peak stood above the correlation around it: the measurement's confidence. */
  readonly peakRatio: number;
}

/** The frames a capture must hold, from the frame the burst was played at, for every lag to be searched. */
export function loopbackCaptureLength(rate: SampleRate): SampleCount {
  return derivedSampleCount(maximumLag(rate) + CALIBRATION_SIGNAL_LENGTH);
}

/**
 * The round trip in `captured`, mono and beginning at the frame the burst was
 * played at, at `rate`; or why no clear one was found.
 */
export function measureRoundTrip(
  captured: Readonly<Float32Array>,
  rate: SampleRate,
): DomainResult<LoopbackMeasurement> {
  // Every lag up to the longest round trip is searched, never fewer: a peak is
  // judged against the floor of the lags around it, and a capture too short to
  // give them would make any lag look clear.
  const needed = loopbackCaptureLength(rate);
  if (captured.length < needed) {
    return refused(
      'recording.loopback-too-short',
      `The capture holds ${String(captured.length)} frames, fewer than the ${String(needed)} a measurement reads.`,
    );
  }

  const lastLag = maximumLag(rate);
  const correlation = correlate(captured, lastLag);
  const peakLag = largestAt(correlation);
  const peak = Math.abs(correlation[peakLag] ?? 0);
  if (peak === 0) {
    return refused(
      'recording.loopback-silent',
      'Nothing was heard back: the capture was silent while the test signal played.',
    );
  }

  const peakRatio = peak / floorAround(correlation, peakLag, Math.ceil(PEAK_SPREAD_SECONDS * rate));
  if (peakRatio < MINIMUM_PEAK_RATIO) {
    return refused(
      'recording.loopback-unclear',
      'The test signal was not heard back clearly enough to measure: place the microphone near the speaker, or connect the output to the input, and measure again.',
      { peakRatio },
    );
  }

  return succeed({ roundTrip: derivedSampleCount(peakLag), peakRatio });
}

function maximumLag(rate: SampleRate): number {
  return Math.ceil(MAXIMUM_ROUND_TRIP_SECONDS * rate);
}

/** The correlation of the burst with `captured` at each lag from zero to `lastLag`. */
function correlate(captured: Readonly<Float32Array>, lastLag: number): Float64Array {
  const burst = calibrationSequence();
  const correlation = new Float64Array(lastLag + 1);
  for (let lag = 0; lag <= lastLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < burst.length; index += 1) {
      sum += (burst[index] ?? 0) * (captured[lag + index] ?? 0);
    }
    correlation[lag] = sum;
  }
  return correlation;
}

/**
 * The lag of the correlation's largest magnitude: a path that inverts the
 * signal, as some microphones and interfaces do, gives a negative peak. The
 * earliest wins a tie, since a reflection arrives after the direct sound.
 */
function largestAt(correlation: Float64Array): number {
  let at = 0;
  let largest = -1;
  for (let lag = 0; lag < correlation.length; lag += 1) {
    const magnitude = Math.abs(correlation[lag] ?? 0);
    if (magnitude > largest) {
      largest = magnitude;
      at = lag;
    }
  }
  return at;
}

/** The root mean square of the correlation away from `peakLag` by more than `spread` lags. */
function floorAround(correlation: Float64Array, peakLag: number, spread: number): number {
  let energy = 0;
  let count = 0;
  for (let lag = 0; lag < correlation.length; lag += 1) {
    if (Math.abs(lag - peakLag) <= spread) continue;
    const value = correlation[lag] ?? 0;
    energy += value * value;
    count += 1;
  }
  return Math.sqrt(energy / count);
}

function refused(
  code: string,
  summary: string,
  details?: Readonly<Record<string, number>>,
): DomainResult<never> {
  return fail(
    failure(code, FailureKind.Rejected, summary, details === undefined ? undefined : { details }),
  );
}
