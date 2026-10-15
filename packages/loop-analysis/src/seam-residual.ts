/**
 * How far a seam's frames stand out of their stream (the plan's
 * `discontinuity`): the click detector's residual (`clicks.ts` through the
 * canonical port: an order-16 prediction-error filter fitted by Burg's method
 * over the stream, each sample's residual, and the stream's median and median
 * absolute deviation) at the seam's frames, in MADs. In MADs, it does not scale
 * with the sample rate or the level.
 *
 * The MAD is floored at the detector's own 2⁻²⁴, and at the stream's RMS 60 dB
 * down, the level the DC metrics also pass at. A pure tone is predicted almost
 * exactly, so its MAD is the noise of rounding, and against that any change,
 * even a crossfade's glide 50 dB under the tone, would read as thousands of
 * deviations; 60 dB under the level of what plays, a residual is below what is
 * heard over it.
 *
 * A seam's frames are the 16 from the first after it: each one's prediction
 * reads across the seam. A jump shows at the first; a turn at a zero, where the
 * first frame is as predicted, shows at the next.
 */

import { DetectorKind } from '@audiogubbins/audio-engine';

import type { MeasuringKit } from './measuring-kit.js';

/** The floor of a deviation, the click detector's `LEAST_DEVIATION`. */
export const LEAST_DEVIATION = 1 / 16_777_216;

/** The least a deviation is measured against, as a share of the stream's RMS: −60 dB. */
const AUDIBLE_SHARE = 0.001;

/** The predictor's order: `ORDER` in `clicks.ts`. */
const PREDICTOR_ORDER = 16;

/** The frames of a stream whose predictions read across a seam before frame `at`. */
export function seamFrames(at: number): readonly number[] {
  return Array.from({ length: PREDICTOR_ORDER }, (_, offset) => at + offset);
}

/** The values of one click record: channel, sample, deviation from the median, MAD. */
const RECORD_WIDTH = 4;

/**
 * For each channel of `stream` (one array per channel, all of one length), the
 * largest deviation in MADs of the residual at any of `atFrames`.
 */
export function seamDeviations(
  kit: MeasuringKit,
  stream: readonly Float32Array[],
  atFrames: readonly number[],
): Float64Array {
  const wanted = new Set(atFrames);
  const channels = stream.length;
  const length = stream[0]?.length ?? 0;
  const made = kit.dsp.createDetectorFeatures({
    kind: DetectorKind.Clicks,
    channels,
    sampleRate: kit.sampleRate,
    block: length,
    // The least sensitivity there is: every residual beyond the detector's
    // floor is reported, and the seam's are picked out below.
    sensitivity: Number.MIN_VALUE,
  });
  // The stream is one block of 128 to 2²⁰ samples on at most 256 channels,
  // which the port always takes; a refusal is a fault in the analysis.
  if (!made.ok) throw new Error(made.failures[0].summary);
  const detector = made.value;
  const deviations = new Float64Array(channels);
  const floors = stream.map((samples) => {
    let squares = 0;
    for (const sample of samples) squares += sample * sample;
    return Math.max(LEAST_DEVIATION, AUDIBLE_SHARE * Math.sqrt(squares / samples.length));
  });
  try {
    detector.push(stream);
    const records = new Float64Array(RECORD_WIDTH * length * channels);
    const count = detector.pull(records);
    for (let record = 0; record < count; record += 1) {
      const at = record * RECORD_WIDTH;
      const channel = records[at] ?? 0;
      if (!wanted.has(records[at + 1] ?? -1)) continue;
      const deviation =
        Math.abs(records[at + 2] ?? 0) /
        Math.max(records[at + 3] ?? 0, floors[channel] ?? LEAST_DEVIATION);
      deviations[channel] = Math.max(deviations[channel] ?? 0, deviation);
    }
  } finally {
    detector.release();
  }
  return deviations;
}
