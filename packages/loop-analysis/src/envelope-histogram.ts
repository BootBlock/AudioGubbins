/**
 * The loop's 10 ms dB envelope as a histogram of fixed resolution (the plan's
 * candidate search, step 2): 0.1 dB bins from −120 to +12 dBFS, so the median
 * and median absolute deviation of every candidate's envelope are read from
 * counts, whatever the loop's length, rather than from every step kept.
 */

import { gainToDecibels } from '@audiogubbins/audio-engine';

/** The quietest step of the envelope: a quieter one reads as this. */
const ENVELOPE_FLOOR_DB = -120;

/** The loudest step the histogram tells apart; louder ones share its top bin. */
const ENVELOPE_CEILING_DB = 12;

/** The width of a bin, in dB. */
const BIN_DB = 0.1;

/** How many bins the histogram has. */
export const ENVELOPE_BINS = Math.round((ENVELOPE_CEILING_DB - ENVELOPE_FLOOR_DB) / BIN_DB);

/** The gain of the floor, under which a step reads as the floor. */
const FLOOR_GAIN = 1e-6;

/** The dB of a step whose squares sum to `sumOfSquares` over `frames` frames. */
export function stepDecibels(sumOfSquares: number, frames: number): number {
  const rms = Math.sqrt(sumOfSquares / frames);
  return rms <= FLOOR_GAIN ? ENVELOPE_FLOOR_DB : Math.max(ENVELOPE_FLOOR_DB, gainToDecibels(rms));
}

/** The bin a step of `decibels` counts in. */
export function binOf(decibels: number): number {
  const bin = Math.floor((decibels - ENVELOPE_FLOOR_DB) / BIN_DB);
  return Math.min(ENVELOPE_BINS - 1, Math.max(0, bin));
}

/** The value a bin stands for: its centre. */
export function binValue(bin: number): number {
  return ENVELOPE_FLOOR_DB + (bin + 0.5) * BIN_DB;
}

/** The index of the median of `count` values in ascending order: the lower of two middles. */
function medianRank(count: number): number {
  return Math.floor((count - 1) / 2);
}

/** The bin holding the value of rank `rank` among the counts of `histogram`. */
function binAtRank(histogram: Uint32Array, rank: number): number {
  let seen = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    seen += histogram[bin] ?? 0;
    if (seen > rank) return bin;
  }
  return histogram.length - 1;
}

/** The median of a histogram and its median absolute deviation, in dB. */
export interface HistogramSpread {
  readonly median: number;
  readonly deviation: number;
}

/**
 * The median of the `count` values counted in `histogram`, and their median
 * absolute deviation, each to the resolution of a bin.
 */
export function histogramSpread(histogram: Uint32Array, count: number): HistogramSpread {
  const rank = medianRank(count);
  const middle = binAtRank(histogram, rank);
  // The deviations are counted by their distance in bins from the median's.
  let seen = 0;
  for (let distance = 0; distance < histogram.length; distance += 1) {
    seen += histogram[middle - distance] ?? 0;
    if (distance > 0) seen += histogram[middle + distance] ?? 0;
    if (seen > rank) return { median: binValue(middle), deviation: distance * BIN_DB };
  }
  return { median: binValue(middle), deviation: 0 };
}
