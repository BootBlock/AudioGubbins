/**
 * The pieces of identity phase locking (Laroche and Dolson, 1999) that every
 * phase vocoder of the engine and its processors shares: the window, the
 * peaks of a frame's magnitudes and the region of bins each peak governs.
 * The stretch's frame transform (`phase-vocoder.ts`) and the pitch shift
 * (`packages/processors`) both call these, so the two lock phases by one
 * rule.
 *
 * Each is IEEE arithmetic in one order and the canonical sine, so every
 * thread finds the same peaks.
 */

import { sineOfTurns } from './reference/primitives.js';

/**
 * The square-rooted periodic Hann window of `size` samples,
 * `w(n) = sin(πn/N)`. Applied before the transform and again after the
 * inverse, the two make the Hann window, whose copies `N/O` apart sum to
 * `O/2`.
 */
export function vocoderWindow(size: number): Float64Array {
  return Float64Array.from({ length: size }, (_, n) => sineOfTurns(n / (2 * size)));
}

/**
 * Writes to `peaks` the bins of `magnitude`, `bins` long, louder than the two
 * on each side, a tie with a later bin counting for the earlier, in order;
 * returns their count. A frame with no partial, such as silence, has none.
 */
export function findPeaks(magnitude: Float64Array, bins: number, peaks: Int32Array): number {
  let count = 0;
  for (let k = 0; k < bins; k += 1) {
    const level = magnitude[k] ?? 0;
    // A neighbour past either end is quieter than any bin. Each is tested
    // rather than read out of bounds, which V8 answers on its slow path,
    // allocating as it goes.
    if (
      level > (k >= 1 ? (magnitude[k - 1] ?? 0) : -1) &&
      level > (k >= 2 ? (magnitude[k - 2] ?? 0) : -1) &&
      level >= (k + 1 < bins ? (magnitude[k + 1] ?? 0) : -1) &&
      level >= (k + 2 < bins ? (magnitude[k + 2] ?? 0) : -1)
    ) {
      peaks[count] = k;
      count += 1;
    }
  }
  return count;
}

/**
 * The bin after the last of the region of peak `index` of the `count` in
 * `peaks`: the bins nearer it than the next peak, the bin halfway between
 * them going to the earlier, and every bin to the last of a frame for its
 * last peak. The first region starts at bin 0 and each starts where the one
 * before ends, so the regions cover the frame.
 */
export function regionEnd(peaks: Int32Array, index: number, count: number, bins: number): number {
  if (index + 1 >= count) return bins;
  return Math.floor(((peaks[index] ?? 0) + (peaks[index + 1] ?? bins)) / 2) + 1;
}
