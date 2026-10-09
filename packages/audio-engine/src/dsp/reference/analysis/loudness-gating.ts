/**
 * The gated measures of a loudness history, as `loudness.rs` computes them:
 * integrated loudness over the gating blocks, and loudness range over the
 * full short-term windows (EBU Tech 3342), each gate passing a value strictly
 * above it, the sums in history order, and the range's percentiles by nearest
 * rank through the canonical selection.
 *
 * The history holds each window's mean square alone, and its loudness is
 * computed where a measure reads it, by the one function `loudness.rs`
 * computes it by as each window ends, so the value is the same.
 */

import { log10 } from '../logarithm.js';
import { rankAt, selectRank } from './selection.js';

/** The absolute gate, in LUFS, and the relative gates of the two measures, in LU. */
const ABSOLUTE_GATE = -70;
const INTEGRATED_RELATIVE_GATE = -10;
const RANGE_RELATIVE_GATE = -20;

/** The loudness of a mean square: `−0.691 + 10 · log10(mean)`; `loudness_of`. */
export function loudnessOf(meanSquare: number): number {
  return -0.691 + 10 * log10(meanSquare);
}

/** Windows' mean squares, appended in order, in an array that grows by doubling. */
export class LoudnessHistory {
  #meanSquares = new Float64Array(64);
  #count = 0;

  get count(): number {
    return this.#count;
  }

  /** The array the mean squares are in, which {@link claim} may replace. */
  get meanSquares(): Float64Array {
    return this.#meanSquares;
  }

  /** Makes room for one more window and answers where its mean square goes. */
  claim(): number {
    if (this.#count === this.#meanSquares.length) {
      const grown = new Float64Array(2 * this.#count);
      grown.set(this.#meanSquares);
      this.#meanSquares = grown;
    }
    this.#count += 1;
    return this.#count - 1;
  }
}

/**
 * The mean of the mean squares whose loudness is above `gate` and the
 * absolute gate, summed in order, or `undefined` where none is; `gated_mean`.
 */
function gatedMean(history: LoudnessHistory, gate: number): number | undefined {
  const meanSquares = history.meanSquares;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < history.count; index += 1) {
    const meanSquare = meanSquares[index] ?? 0;
    const loudness = loudnessOf(meanSquare);
    if (loudness > ABSOLUTE_GATE && loudness > gate) {
      sum += meanSquare;
      count += 1;
    }
  }
  return count > 0 ? sum / count : undefined;
}

/** The integrated loudness of the gating blocks `blocks`, in LUFS; `integrated`. */
export function integratedLoudness(blocks: LoudnessHistory): number {
  const mean = gatedMean(blocks, ABSOLUTE_GATE);
  if (mean === undefined) return Number.NEGATIVE_INFINITY;
  const gated = gatedMean(blocks, loudnessOf(mean) + INTEGRATED_RELATIVE_GATE);
  return gated === undefined ? Number.NEGATIVE_INFINITY : loudnessOf(gated);
}

/** The loudness range of the short-term windows `shortTerms`, in LU; `loudness_range`. */
export function loudnessRange(shortTerms: LoudnessHistory): number {
  const mean = gatedMean(shortTerms, ABSOLUTE_GATE);
  if (mean === undefined) return 0;
  const relative = loudnessOf(mean) + RANGE_RELATIVE_GATE;
  // Made per reading, which is not a call on the audio thread's path.
  const values = new Float64Array(shortTerms.count);
  let count = 0;
  for (let index = 0; index < shortTerms.count; index += 1) {
    const loudness = loudnessOf(shortTerms.meanSquares[index] ?? 0);
    if (loudness > ABSOLUTE_GATE && loudness > relative) {
      values[count] = loudness;
      count += 1;
    }
  }
  if (count === 0) return 0;
  // The tenth percentile is read before the second selection moves it.
  const lowRank = rankAt(count, 0.1);
  selectRank(values, count, lowRank);
  const low = values[lowRank] ?? 0;
  const highRank = rankAt(count, 0.95);
  selectRank(values, count, highRank);
  return (values[highRank] ?? 0) - low;
}
