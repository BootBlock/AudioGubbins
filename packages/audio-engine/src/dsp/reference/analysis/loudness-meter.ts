/**
 * Loudness per ITU-R BS.1770-4 and EBU R 128, as `loudness.rs` measures it,
 * operation for operation: each channel K-weighted and its squares summed
 * over 100 ms steps (step `j` the samples from `⌊j · rate / 10⌋`), a step's
 * weighted sum `Σ Gᵢ · Sᵢ` channel by channel, and each window's mean square
 * its steps' weighted sums over their lengths, oldest first (ADR-0032).
 */

import { kWeighting, runBiquad, type Biquad } from './k-weighting.js';
import {
  LoudnessHistory,
  integratedLoudness,
  loudnessOf,
  loudnessRange,
} from './loudness-gating.js';

/** The steps of a momentary and of a short-term window. */
const MOMENTARY_STEPS = 4;
const SHORT_TERM_STEPS = 30;

/** A loudness meter of one stream, its settings already checked. */
export class ReferenceLoudnessMeter {
  readonly channels: number;
  readonly #stages: readonly [Biquad, Biquad];
  readonly #weights: Float64Array;
  /** Per channel, four values: the shelf's state, then the high-pass filter's. */
  readonly #states: Float64Array;
  readonly #sums: Float64Array;
  /** A step's whole samples, and the tenths of a sample each step adds to the next edge. */
  readonly #baseLength: number;
  readonly #extraTenths: number;
  #tenths = 0;
  #filled = 0;
  #length: number;
  /** The last 30 steps' weighted sums and lengths, oldest first. */
  readonly #recentSums = new Float64Array(SHORT_TERM_STEPS);
  readonly #recentLengths = new Float64Array(SHORT_TERM_STEPS);
  #recentCount = 0;
  readonly #blocks = new LoudnessHistory();
  readonly #shortTerms = new LoudnessHistory();
  /** Momentary and short-term loudness not yet pulled, in pairs. */
  #series = new Float64Array(64);
  #seriesCount = 0;

  constructor(sampleRate: number, weights: Float64Array) {
    this.channels = weights.length;
    this.#stages = kWeighting(sampleRate);
    this.#weights = weights;
    this.#states = new Float64Array(4 * weights.length);
    this.#sums = new Float64Array(weights.length);
    this.#baseLength = Math.floor(sampleRate / 10);
    this.#extraTenths = sampleRate % 10;
    this.#length = this.#nextLength();
  }

  /**
   * The next step's length, `⌊(j + 1) · rate / 10⌋ − ⌊j · rate / 10⌋`, kept
   * exact by carrying the tenths of a sample past each edge.
   */
  #nextLength(): number {
    this.#tenths += this.#extraTenths;
    if (this.#tenths >= 10) {
      this.#tenths -= 10;
      return this.#baseLength + 1;
    }
    return this.#baseLength;
  }

  /** Measures one chunk of `frames` samples a channel, its shape checked by the port. */
  push(input: readonly Float32Array[], frames: number): void {
    const [shelf, highPass] = this.#stages;
    let offset = 0;
    while (offset < frames) {
      const take = Math.min(this.#length - this.#filled, frames - offset);
      for (let channel = 0; channel < this.channels; channel += 1) {
        const samples = input[channel];
        if (samples === undefined) continue;
        let sum = this.#sums[channel] ?? 0;
        const at = 4 * channel;
        for (let n = offset; n < offset + take; n += 1) {
          const shelved = runBiquad(shelf, this.#states, at, samples[n] ?? 0);
          const weighted = runBiquad(highPass, this.#states, at + 2, shelved);
          sum += weighted * weighted;
        }
        this.#sums[channel] = sum;
      }
      offset += take;
      this.#filled += take;
      if (this.#filled === this.#length) this.#closeStep();
    }
  }

  /**
   * Ends the current step and measures the windows that end with it;
   * `close_step`. The window sums are written out here rather than in a
   * helper answering a number, which a call made once a step could leave out
   * of line, and an out-of-line number is an allocation.
   */
  #closeStep(): void {
    let weighted = 0;
    for (let channel = 0; channel < this.channels; channel += 1) {
      weighted += (this.#weights[channel] ?? 0) * (this.#sums[channel] ?? 0);
      this.#sums[channel] = 0;
    }
    this.#recentSums.copyWithin(0, 1);
    this.#recentLengths.copyWithin(0, 1);
    this.#recentSums[SHORT_TERM_STEPS - 1] = weighted;
    this.#recentLengths[SHORT_TERM_STEPS - 1] = this.#length;
    this.#recentCount = Math.min(this.#recentCount + 1, SHORT_TERM_STEPS);
    this.#filled = 0;
    this.#length = this.#nextLength();
    if (this.#recentCount < MOMENTARY_STEPS) return;
    // Each window's sums, oldest step first: `mean_square`.
    let momentarySum = 0;
    let momentaryLength = 0;
    let shortTermSum = 0;
    let shortTermLength = 0;
    for (let index = SHORT_TERM_STEPS - this.#recentCount; index < SHORT_TERM_STEPS; index += 1) {
      const sum = this.#recentSums[index] ?? 0;
      const length = this.#recentLengths[index] ?? 0;
      if (index >= SHORT_TERM_STEPS - MOMENTARY_STEPS) {
        momentarySum += sum;
        momentaryLength += length;
      }
      shortTermSum += sum;
      shortTermLength += length;
    }
    const momentary = momentarySum / momentaryLength;
    const shortTerm = shortTermSum / shortTermLength;
    // Claimed first: a claim may replace the array the value goes into.
    const block = this.#blocks.claim();
    this.#blocks.meanSquares[block] = momentary;
    if (this.#recentCount === SHORT_TERM_STEPS) {
      const window = this.#shortTerms.claim();
      this.#shortTerms.meanSquares[window] = shortTerm;
    }
    if (this.#seriesCount + 2 > this.#series.length) this.#growSeries();
    this.#series[this.#seriesCount] = loudnessOf(momentary);
    this.#series[this.#seriesCount + 1] = loudnessOf(shortTerm);
    this.#seriesCount += 2;
  }

  #growSeries(): void {
    const grown = new Float64Array(2 * this.#series.length);
    grown.set(this.#series);
    this.#series = grown;
  }

  /** Writes the pairs not yet pulled, as many as `into` holds, and answers how many; `pull_series`. */
  pullSeries(into: Float64Array): number {
    const values = Math.min(Math.floor(into.length / 2) * 2, this.#seriesCount);
    for (let index = 0; index < values; index += 1) into[index] = this.#series[index] ?? 0;
    this.#series.copyWithin(0, values, this.#seriesCount);
    this.#seriesCount -= values;
    return values / 2;
  }

  /** The integrated loudness of everything measured, in LUFS. */
  integrated(): number {
    return integratedLoudness(this.#blocks);
  }

  /** The loudness range of everything measured, in LU. */
  range(): number {
    return loudnessRange(this.#shortTerms);
  }
}
