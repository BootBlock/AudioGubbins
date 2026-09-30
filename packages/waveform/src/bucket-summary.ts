/**
 * One bucket's summary of the samples it covers: the envelope, rounded outward
 * to its steps, the root mean square, and whether any sample reached full scale
 * or was not finite (ADR-0043). The pyramid's level zero and a detail window
 * are both made of these, by the one rule, so a detail bucket and the
 * level-zero bucket it lies in never disagree about a sample.
 */

import type { PeakChannel } from './peak-pyramid.js';
import { highStep, lowStep, rmsStep } from './quantisation.js';

/**
 * Summarises `count` samples of `samples` from `from` into bucket `index` of
 * `into`, and answers their mean square in full precision, which a level above
 * combines.
 */
export function summariseBucket(
  samples: Float32Array,
  from: number,
  count: number,
  into: PeakChannel,
  index: number,
): number {
  let low = Infinity;
  let high = -Infinity;
  let sum = 0;
  let clipped = 0;
  for (let sample = from; sample < from + count; sample += 1) {
    const value = samples[sample] ?? 0;
    if (!Number.isFinite(value)) {
      clipped = 1;
      continue;
    }
    if (value < low) low = value;
    if (value > high) high = value;
    sum += value * value;
    if (value >= 1 || value <= -1) clipped = 1;
  }
  const meanSquare = count > 0 ? sum / count : 0;
  into.minimum[index] = low === Infinity ? 0 : lowStep(low);
  into.maximum[index] = high === -Infinity ? 0 : highStep(high);
  into.rms[index] = rmsStep(Math.sqrt(meanSquare));
  into.clipped[index] = clipped;
  return meanSquare;
}
