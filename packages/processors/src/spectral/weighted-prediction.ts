/**
 * The dereverberation's change to each frame: weighted prediction error (T.
 * Nakatani et al., "Speech Dereverberation Based on Variance-Normalized
 * Delayed Linear Prediction", IEEE Trans. ASLP 18 (2010)) in its recursive
 * form (T. Yoshioka and T. Nakatani, "Generalization of Multi-Channel Linear
 * Prediction Methods for Blind MIMO Impulse Response Shortening", IEEE Trans.
 * ASLP 20 (2012)), every channel predicted from every channel.
 *
 * At each bin, with `y_c` the frame's bin on channel `c` and `x` the
 * `M = C · K` bins of the frames `D` to `D + K − 1` before it, channel by
 * channel, the nearest first:
 *
 * - the late reverberation is predicted by the filter the frames before make,
 *   `g_c = (R + δI)⁻¹ r_c`, as `p_c = g_cᴴ x = r_cᴴ z` with `(R + δI) z = x`,
 *   one solve for every channel where the filter itself would take one each,
 *   and the bin written is `y_c − s · p_c`, `s` the strength;
 * - the weight is the frame's power at the bin, `λ = max(Σ_c |y_c|² / C, ε)`,
 *   standing for the desired signal's as the recursive form's practice has it
 *   (J. Caroselli et al., "Adaptive Multichannel Dereverberation for Automatic
 *   Speech Recognition", Interspeech 2017), the batch method's first
 *   iteration: weighted by an error the filter itself made, a frame it
 *   predicted well by chance would weigh without bound and pull it from the
 *   room; `ε = 10⁻¹² · N / 2` is the power of white noise at −120 dBFS in a
 *   bin, below which a frame is silence;
 * - the weighted statistics forget at `α = e^(−hop / (τ · rate))`, `τ` the
 *   adaptation time, `R ← α R + x xᴴ / λ` and
 *   `r_c ← α r_c + x · conj(y_c) / λ`, each value through `flushSubnormal`;
 * - the solve is by Cholesky (`hermitian-solver.ts`), loaded by
 *   `δ = 10⁻³ · trace(R) / M + 10⁻⁹`, so the filter stays bounded where the
 *   input is predictable and is zero after silence; a frame whose factor
 *   rounding leaves without a positive pivot predicts nothing.
 *
 * One estimate a frame, from the filter so far, takes the place of the batch
 * method's iterations, which would need the whole input before its first
 * frame. The bins run in order from 0, and each bin's state is its own.
 */

import { exp } from '@audiogubbins/audio-engine';

import { flushSubnormal } from '../framework/sample-safety.js';
import type { FrameAnalysis } from './frame-analysis.js';
import { HermitianSolver } from './hermitian-solver.js';
import type { SpectralTransform } from './overlap-add.js';

/** What the prediction is made of. */
export interface PredictionParts {
  readonly analysis: FrameAnalysis;
  /** `D`, the frames between a frame and the nearest the filter reads. */
  readonly delay: number;
  /** `K`, the frames of each channel the filter reads. */
  readonly order: number;
  readonly rate: number;
  /** The strength, in per cent, and the adaptation time, in seconds, over the block. */
  readonly strength: Float64Array;
  readonly adaptation: Float64Array;
}

/** The loading's share of the mean of `R`'s diagonal, and its least value. */
const RELATIVE_LOADING = 1e-3;
const LEAST_LOADING = 1e-9;

/**
 * The flush, taken from its import once: the update calls it twice for every
 * value of a bin's statistics, and a test host's module loader reads each
 * imported name through a getter, which made the update four times slower.
 */
const flush = flushSubnormal;

/** Indices into the frame's scalars. */
const FORGETTING = 0;
const STRENGTH = 1;
const INVERSE_WEIGHT = 2;

export class WeightedPrediction implements SpectralTransform {
  readonly #parts: PredictionParts;
  readonly #channels: number;
  readonly #taps: number;
  readonly #bins: number;
  readonly #slots: number;
  readonly #floor: number;
  readonly #solver: HermitianSolver;
  /** The frames read, ring slot by channel by bin, and the slot of the frame being changed. */
  readonly #historyRe: Float64Array;
  readonly #historyIm: Float64Array;
  #slot = 0;
  /** `R` of each bin, packed, and `r` of each bin, tap by channel. */
  readonly #covarianceRe: Float64Array;
  readonly #covarianceIm: Float64Array;
  readonly #crossRe: Float64Array;
  readonly #crossIm: Float64Array;
  /** `x`, `z` and `y` of the bin being changed. */
  readonly #pastRe: Float64Array;
  readonly #pastIm: Float64Array;
  readonly #solvedRe: Float64Array;
  readonly #solvedIm: Float64Array;
  readonly #nowRe: Float64Array;
  readonly #nowIm: Float64Array;
  /**
   * `α`, `s` and `1 / λ`, in an array, as V8 boxes a double a call passes
   * or returns wherever it does not inline the call, an allocation on the
   * audio thread.
   */
  readonly #scalars = new Float64Array(3);

  constructor(parts: PredictionParts) {
    this.#parts = parts;
    const { analysis, delay, order } = parts;
    const channels = analysis.channels;
    const taps = channels * order;
    const bins = analysis.bins;
    this.#channels = channels;
    this.#taps = taps;
    this.#bins = bins;
    this.#slots = delay + order;
    this.#floor = 1e-12 * (analysis.size / 2);
    this.#solver = new HermitianSolver(taps);
    this.#historyRe = new Float64Array(this.#slots * channels * bins);
    this.#historyIm = new Float64Array(this.#slots * channels * bins);
    this.#covarianceRe = new Float64Array(bins * this.#solver.packed);
    this.#covarianceIm = new Float64Array(bins * this.#solver.packed);
    this.#crossRe = new Float64Array(bins * taps * channels);
    this.#crossIm = new Float64Array(bins * taps * channels);
    this.#pastRe = new Float64Array(taps);
    this.#pastIm = new Float64Array(taps);
    this.#solvedRe = new Float64Array(taps);
    this.#solvedIm = new Float64Array(taps);
    this.#nowRe = new Float64Array(channels);
    this.#nowIm = new Float64Array(channels);
  }

  transform(frame: number): void {
    this.#design(frame);
    for (let bin = 0; bin < this.#bins; bin += 1) {
      this.#gather(bin);
      this.#solve(bin);
      this.#predict(bin);
      this.#update(bin);
    }
    this.#slot = this.#slot + 1 === this.#slots ? 0 : this.#slot + 1;
  }

  /**
   * The strength at `frame`, and `α` for the adaptation time there: made
   * every frame, as code that ran only when the time moved would stay in V8's
   * interpreter, where every double it makes is an allocation.
   */
  #design(frame: number): void {
    const { analysis, rate, strength, adaptation } = this.#parts;
    const scalars = this.#scalars;
    scalars[STRENGTH] = (strength[frame] ?? 0) / 100;
    scalars[FORGETTING] = exp(-analysis.hop / ((adaptation[frame] ?? 1) * rate));
  }

  /** `x` and `y` of bin `bin`, and `y` kept in the history for the frames after. */
  #gather(bin: number): void {
    const { analysis, delay, order } = this.#parts;
    const channels = this.#channels;
    const slots = this.#slots;
    for (let channel = 0; channel < channels; channel += 1) {
      for (let tap = 0; tap < order; tap += 1) {
        // The frame `delay + tap` before this one, `slots` frames to a ring.
        let slot = this.#slot - delay - tap;
        if (slot < 0) slot += slots;
        const at = (slot * channels + channel) * this.#bins + bin;
        this.#pastRe[channel * order + tap] = this.#historyRe[at] ?? 0;
        this.#pastIm[channel * order + tap] = this.#historyIm[at] ?? 0;
      }
      // Explicit tests, not `?.[…]`: the optional read allocates in the
      // optimised code.
      const real = analysis.real[channel];
      const imaginary = analysis.imaginary[channel];
      const re = real === undefined ? 0 : (real[bin] ?? 0);
      const im = imaginary === undefined ? 0 : (imaginary[bin] ?? 0);
      this.#nowRe[channel] = re;
      this.#nowIm[channel] = im;
      const now = (this.#slot * channels + channel) * this.#bins + bin;
      this.#historyRe[now] = re;
      this.#historyIm[now] = im;
    }
  }

  /** Bin `bin` of every channel less its predicted reverberation, `r_cᴴ z`, and the weight `1 / λ`. */
  #predict(bin: number): void {
    const { analysis } = this.#parts;
    const channels = this.#channels;
    const taps = this.#taps;
    const strength = this.#scalars[STRENGTH] ?? 0;
    const crossRe = this.#crossRe;
    const crossIm = this.#crossIm;
    const solvedRe = this.#solvedRe;
    const solvedIm = this.#solvedIm;
    let power = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      let predictedRe = 0;
      let predictedIm = 0;
      for (let tap = 0; tap < taps; tap += 1) {
        // conj(r_c) · z, tap by tap
        const at = (bin * taps + tap) * channels + channel;
        const rRe = crossRe[at] ?? 0;
        const rIm = crossIm[at] ?? 0;
        const zRe = solvedRe[tap] ?? 0;
        const zIm = solvedIm[tap] ?? 0;
        predictedRe += rRe * zRe + rIm * zIm;
        predictedIm += rRe * zIm - rIm * zRe;
      }
      const yRe = this.#nowRe[channel] ?? 0;
      const yIm = this.#nowIm[channel] ?? 0;
      power += yRe * yRe + yIm * yIm;
      const real = analysis.real[channel];
      const imaginary = analysis.imaginary[channel];
      if (real === undefined || imaginary === undefined) continue;
      real[bin] = yRe - strength * predictedRe;
      imaginary[bin] = yIm - strength * predictedIm;
    }
    const weight = power / channels;
    this.#scalars[INVERSE_WEIGHT] = 1 / (weight > this.#floor ? weight : this.#floor);
  }

  /** `R` and every `r_c` of bin `bin` forgotten by `α` and joined by this frame, weighted. */
  #update(bin: number): void {
    const taps = this.#taps;
    const channels = this.#channels;
    const alpha = this.#scalars[FORGETTING] ?? 0;
    const inverse = this.#scalars[INVERSE_WEIGHT] ?? 0;
    const pastRe = this.#pastRe;
    const pastIm = this.#pastIm;
    const nowRe = this.#nowRe;
    const nowIm = this.#nowIm;
    const covarianceRe = this.#covarianceRe;
    const covarianceIm = this.#covarianceIm;
    const crossRe = this.#crossRe;
    const crossIm = this.#crossIm;
    let at = bin * this.#solver.packed;
    for (let i = 0; i < taps; i += 1) {
      const aRe = (pastRe[i] ?? 0) * inverse;
      const aIm = (pastIm[i] ?? 0) * inverse;
      for (let j = i; j < taps; j += 1, at += 1) {
        const bRe = pastRe[j] ?? 0;
        const bIm = pastIm[j] ?? 0;
        const re = alpha * (covarianceRe[at] ?? 0) + (aRe * bRe + aIm * bIm);
        const im = alpha * (covarianceIm[at] ?? 0) + (aIm * bRe - aRe * bIm);
        covarianceRe[at] = flush(re);
        covarianceIm[at] = flush(im);
      }
      const cross = (bin * taps + i) * channels;
      for (let channel = 0; channel < channels; channel += 1) {
        const yRe = nowRe[channel] ?? 0;
        const yIm = nowIm[channel] ?? 0;
        const re = alpha * (crossRe[cross + channel] ?? 0) + (aRe * yRe + aIm * yIm);
        const im = alpha * (crossIm[cross + channel] ?? 0) + (aIm * yRe - aRe * yIm);
        crossRe[cross + channel] = flush(re);
        crossIm[cross + channel] = flush(im);
      }
    }
  }

  /** `z` of bin `bin`, solving `(R + δI) z = x` by the frames before, or zero where it cannot. */
  #solve(bin: number): void {
    const solver = this.#solver;
    const taps = this.#taps;
    const base = bin * solver.packed;
    let trace = 0;
    for (let i = 0; i < taps; i += 1) {
      trace += this.#covarianceRe[base + (solver.rowStart[i] ?? 0)] ?? 0;
    }
    solver.loading[0] = (RELATIVE_LOADING * trace) / taps + LEAST_LOADING;
    if (solver.factorise(this.#covarianceRe, this.#covarianceIm, base)) {
      solver.solve(this.#pastRe, this.#pastIm, this.#solvedRe, this.#solvedIm);
    } else {
      this.#solvedRe.fill(0);
      this.#solvedIm.fill(0);
    }
  }
}
