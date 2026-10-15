/**
 * How steady a loop is across its seam and over its cycle (the plan's
 * `cycleStability`), from the 10 ms dB envelope the pass kept.
 *
 * - `seam`: the level of the 10 ms the engine plays across the seam, the last 5
 *   ms before E and the first 5 ms from S, against the median of the loop's
 *   envelope, in robust deviations,
 *   `|e_seam − median| ÷ max(1.4826 · MAD, 0.05 dB)`: a seam that dips or jumps
 *   against a level the loop otherwise holds.
 * - `drift`: how the level a repeat jumps between differs from the level the
 *   region's own audio moves between, over `q = max(L/8, 100 ms)`, at most half
 *   the loop: a loop that fades or swells, which a repeat makes a jump.
 *   Compared, as every seam metric is, with what should follow E or precede S
 *   where the region has it: the mean level of the loop's first `q` against the
 *   `q` after E (`post-end`), or of the `q` before S against the loop's last
 *   `q` (`pre-start`), so a drum loop's hit after its decay is no drift where
 *   the region's own audio hits there too; and the loop's first `q` against its
 *   last only where the region has neither (`adjacent`).
 *
 * An envelope step counts where it lies whole inside the loop.
 */

import { ENVELOPE_BINS, binOf, histogramSpread, stepDecibels } from './envelope-histogram.js';
import type { LoopCapture } from './loop-capture.js';
import { seamEnvelopeFrames } from './loop-windows.js';
import type { ChannelReading, SeamReference } from './verdicts.js';

/** The robust scale of a median absolute deviation, which makes it a standard deviation for normal data. */
const MAD_SCALE = 1.4826;

/** The least deviation a seam is measured against: 0.05 dB. */
const LEAST_DEVIATION_DB = 0.05;

/** Why a loop has no envelope to measure against. */
const NO_ENVELOPE = 'The loop is shorter than one 10 ms step of its envelope.';

/** Why a loop has no drift to measure. */
const NO_DRIFT = 'The loop is too short for its first and last parts to hold a 10 ms step each.';

/** The longest the drift compares at either end of a loop of `length` frames. */
export function driftSpan(sampleRate: number, length: number): number {
  return Math.min(
    Math.max(Math.round(length / 8), Math.round(0.1 * sampleRate)),
    Math.floor(length / 2),
  );
}

/** The kept steps lying whole inside `[from, to)`, in grid order. */
function keptStepsWithin(capture: LoopCapture, from: number, to: number): readonly Float64Array[] {
  const { origin, cell, kept } = capture.envelope;
  const steps: Float64Array[] = [];
  const first = Math.ceil((from - origin) / cell);
  const last = Math.floor((to - origin) / cell);
  for (let step = first; step < last; step += 1) {
    const values = kept.get(step);
    if (values !== undefined) steps.push(values);
  }
  return steps;
}

/** The level in dB of the 10 ms across the seam of `[start, end)` on `channel`. */
function seamDecibels(capture: LoopCapture, channel: number, start: number, end: number): number {
  const half = seamEnvelopeFrames(capture.sampleRate);
  let squares = 0;
  for (const sample of capture.samples(channel, end - half, end)) squares += sample * sample;
  for (const sample of capture.samples(channel, start, start + half)) squares += sample * sample;
  return stepDecibels(squares, 2 * half);
}

/** Each channel's seam stability of the loop `[start, end)`. */
export function seamStability(
  capture: LoopCapture,
  start: number,
  end: number,
): readonly ChannelReading[] {
  const { core, coreCount } = capture.envelope;
  const steps = keptStepsWithin(capture, start, end);
  const count = coreCount + steps.length;
  return Array.from({ length: capture.channels }, (_, channel): ChannelReading => {
    if (count === 0) return { notApplicable: NO_ENVELOPE };
    const histogram = new Uint32Array(core[channel] ?? new Uint32Array(ENVELOPE_BINS));
    for (const values of steps) {
      const bin = binOf(values[channel] ?? 0);
      histogram[bin] = (histogram[bin] ?? 0) + 1;
    }
    const { median, deviation } = histogramSpread(histogram, count);
    const scale = Math.max(MAD_SCALE * deviation, LEAST_DEVIATION_DB);
    return { value: Math.abs(seamDecibels(capture, channel, start, end) - median) / scale };
  });
}

/** The mean of `channel` over `steps`, in dB. */
function meanOf(steps: readonly Float64Array[], channel: number): number {
  let sum = 0;
  for (const values of steps) sum += values[channel] ?? 0;
  return sum / steps.length;
}

/** The two spans of `q` frames whose levels the drift compares by its reference, played first. */
function driftSpans(
  start: number,
  end: number,
  span: number,
  regionLength: number,
): {
  readonly reference: SeamReference;
  readonly spans: readonly [number, number, number, number];
} {
  if (end + span <= regionLength) {
    return { reference: 'post-end', spans: [start, start + span, end, end + span] };
  }
  if (start - span >= 0)
    return { reference: 'pre-start', spans: [end - span, end, start - span, start] };
  return { reference: 'adjacent', spans: [start, start + span, end - span, end] };
}

/** Each channel's drift over the loop `[start, end)`, in dB. */
export function cycleDrift(
  capture: LoopCapture,
  start: number,
  end: number,
): readonly ChannelReading[] {
  const span = driftSpan(capture.sampleRate, end - start);
  const { reference, spans } = driftSpans(start, end, span, capture.regionLength);
  const [playedFrom, playedTo, expectedFrom, expectedTo] = spans;
  const played = keptStepsWithin(capture, playedFrom, playedTo);
  const expected = keptStepsWithin(capture, expectedFrom, expectedTo);
  return Array.from({ length: capture.channels }, (_, channel): ChannelReading =>
    played.length === 0 || expected.length === 0
      ? { notApplicable: NO_DRIFT }
      : { value: Math.abs(meanOf(played, channel) - meanOf(expected, channel)), reference },
  );
}
