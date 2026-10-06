/**
 * The noise reduction's change to each frame: a gain per bin by magnitude
 * spectral subtraction (S. F. Boll, "Suppression of Acoustic Noise in Speech
 * Using Spectral Subtraction", IEEE Trans. ASSP 27 (1979)) with an
 * over-subtraction factor and a spectral floor (M. Berouti, R. Schwartz and
 * J. Makhoul, "Enhancement of Speech Corrupted by Acoustic Noise", ICASSP
 * 1979), smoothed across frequency and then over time against musical noise.
 *
 * For bin `k` of magnitude `|X|`, and the profile's mean magnitude `N̄` there:
 *
 * - the raw gain is `g = max(1 − α · N̄ / |X|, β)`, and `β` where `|X|` is
 *   zero, with `α = 10^(sensitivity / 20)` and `β = 10^(−reduction / 20)`;
 * - across frequency,
 *   `g_f[k] = (1 − s) · g[k] + s · (g[k−1] + 2g[k] + g[k+1]) / 4`, `s` the
 *   smoothing as a fraction, the bins past each end reflected (`g[−1] = g[1]`,
 *   `g[K] = g[K−2]`);
 * - over time, `G ← G + c · (g_f − G)`, `c = 1 − e^(−hop / (τ · rate))`, with
 *   `τ = s · 25 ms` as the gain rises and `s · 250 ms` as it falls, so a sound
 *   comes through at once and the noise under it fades rather than flickers;
 *   `c = 1` with no smoothing, and `G` starts at 1;
 * - the bin written is `G · X`, or `(1 − G) · X` for the noise removed alone.
 *
 * Every value `G` is made of lies in `[β, 1]`, so it does too, and at a
 * reduction of 0 dB every gain is 1 and the frame is unchanged. An ambisonic
 * set is reduced linked: one gain per bin, from `|X| = √Σ|X_c|²` and
 * `N̄ = √Σ N̄_c²` over its channels, for every channel, since a gain of each
 * component's own would move the sources of the field.
 *
 * The parameters are read at the frame's last sample from their ramps.
 */

import { decibelsToGain, exp } from '@audiogubbins/audio-engine';

import type { FrameAnalysis } from './frame-analysis.js';
import type { SpectralTransform } from './overlap-add.js';

/** The time constants of the gain as it rises and as it falls, in seconds at full smoothing. */
const RISE_SECONDS = 0.025;
export const FALL_SECONDS = 0.25;

/** What the subtraction is made of. */
export interface SubtractionParts {
  readonly analysis: FrameAnalysis;
  /** Each channel's profile set, the same array for every channel where it is shared. */
  readonly profile: readonly Float64Array[];
  readonly linked: boolean;
  /** Whether it writes the noise removed rather than what is left. */
  readonly noiseOnly: boolean;
  readonly rate: number;
  /** The values of the reduction, sensitivity and smoothing over the block, from their ramps. */
  readonly reduction: Float64Array;
  readonly sensitivity: Float64Array;
  readonly smoothing: Float64Array;
}

/** Indices into the coefficients the parameters make. */
const ALPHA = 0;
const BETA = 1;
const SMOOTHING = 2;
const RISE = 3;
const FALL = 4;

export class SpectralSubtraction implements SpectralTransform {
  readonly #parts: SubtractionParts;
  /** The profile of each set of channels a gain is made for: each channel, or the linked set. */
  readonly #profile: readonly Float64Array[];
  /** Each set's gain over time, `G`. */
  readonly #gains: readonly Float64Array[];
  /** The latest frame's magnitudes, then its raw gains, and the gains smoothed across. */
  readonly #raw: Float64Array;
  readonly #across: Float64Array;
  /**
   * `α`, `β`, `s` and the rising and falling `c`, in an array, as is every
   * double here a call would otherwise pass or return: V8 boxes one wherever
   * it does not inline the call, an allocation on the audio thread.
   */
  readonly #coefficients = new Float64Array(5);

  constructor(parts: SubtractionParts) {
    this.#parts = parts;
    const { bins } = parts.analysis;
    this.#profile = parts.linked ? [linkedProfile(parts.profile, bins)] : parts.profile;
    this.#gains = this.#profile.map(() => new Float64Array(bins).fill(1));
    this.#raw = new Float64Array(bins);
    this.#across = new Float64Array(bins);
  }

  transform(frame: number): void {
    this.#design(frame);
    for (let set = 0; set < this.#gains.length; set += 1) {
      this.#magnitudes(set);
      this.#rawGains(set);
      this.#smoothAcross();
      this.#smoothOver(set);
      this.#apply(set);
    }
  }

  /**
   * The coefficients for the parameters at `frame`. Made every frame, not
   * only when one moves: the conversions cost nothing beside a transform, and
   * code that ran only on a move would stay in V8's interpreter, where every
   * double it makes is an allocation.
   */
  #design(frame: number): void {
    const { analysis, rate, reduction, sensitivity, smoothing } = this.#parts;
    const coefficients = this.#coefficients;
    const s = (smoothing[frame] ?? 0) / 100;
    coefficients[ALPHA] = decibelsToGain(sensitivity[frame] ?? 0);
    coefficients[BETA] = decibelsToGain(-(reduction[frame] ?? 0));
    coefficients[SMOOTHING] = s;
    coefficients[RISE] = s === 0 ? 1 : 1 - exp(-analysis.hop / (s * RISE_SECONDS * rate));
    coefficients[FALL] = s === 0 ? 1 : 1 - exp(-analysis.hop / (s * FALL_SECONDS * rate));
  }

  /** The latest frame's magnitude at every bin of set `set` into the raw gains' place. */
  #magnitudes(set: number): void {
    const { analysis, linked } = this.#parts;
    const raw = this.#raw;
    const first = linked ? 0 : set;
    const last = linked ? analysis.channels : set + 1;
    raw.fill(0);
    for (let channel = first; channel < last; channel += 1) {
      const real = analysis.real[channel];
      const imaginary = analysis.imaginary[channel];
      if (real === undefined || imaginary === undefined) continue;
      for (let bin = 0; bin < raw.length; bin += 1) {
        const re = real[bin] ?? 0;
        const im = imaginary[bin] ?? 0;
        raw[bin] = (raw[bin] ?? 0) + (re * re + im * im);
      }
    }
    for (let bin = 0; bin < raw.length; bin += 1) raw[bin] = Math.sqrt(raw[bin] ?? 0);
  }

  /** Replaces each magnitude of set `set` with its raw gain, `max(1 − α · N̄ / |X|, β)`. */
  #rawGains(set: number): void {
    const raw = this.#raw;
    const profile = this.#profile[set];
    if (profile === undefined) return;
    const alpha = this.#coefficients[ALPHA] ?? 1;
    const beta = this.#coefficients[BETA] ?? 1;
    for (let bin = 0; bin < raw.length; bin += 1) {
      const magnitude = raw[bin] ?? 0;
      const gain = magnitude > 0 ? 1 - (alpha * (profile[bin] ?? 0)) / magnitude : beta;
      raw[bin] = gain > beta ? gain : beta;
    }
  }

  /** The raw gains smoothed across frequency, the ends reflected. */
  #smoothAcross(): void {
    const raw = this.#raw;
    const across = this.#across;
    const s = this.#coefficients[SMOOTHING] ?? 0;
    const last = raw.length - 1;
    for (let bin = 0; bin <= last; bin += 1) {
      const below = raw[bin === 0 ? 1 : bin - 1] ?? 0;
      const above = raw[bin === last ? last - 1 : bin + 1] ?? 0;
      const own = raw[bin] ?? 0;
      across[bin] = (1 - s) * own + (s * (below + 2 * own + above)) / 4;
    }
  }

  /** Set `set`'s gains moved towards the smoothed raw gains, quickly as they rise, slowly as they fall. */
  #smoothOver(set: number): void {
    const gains = this.#gains[set];
    if (gains === undefined) return;
    const across = this.#across;
    const rise = this.#coefficients[RISE] ?? 1;
    const fall = this.#coefficients[FALL] ?? 1;
    for (let bin = 0; bin < gains.length; bin += 1) {
      const gain = gains[bin] ?? 1;
      const target = across[bin] ?? 1;
      gains[bin] = gain + (target > gain ? rise : fall) * (target - gain);
    }
  }

  /** Every bin of the channels of set `set` times its gain, or times what its gain removes. */
  #apply(set: number): void {
    const { analysis, linked, noiseOnly } = this.#parts;
    const gains = this.#gains[set];
    if (gains === undefined) return;
    const first = linked ? 0 : set;
    const last = linked ? analysis.channels : set + 1;
    for (let channel = first; channel < last; channel += 1) {
      const real = analysis.real[channel];
      const imaginary = analysis.imaginary[channel];
      if (real === undefined || imaginary === undefined) continue;
      for (let bin = 0; bin < gains.length; bin += 1) {
        const gain = noiseOnly ? 1 - (gains[bin] ?? 1) : (gains[bin] ?? 1);
        real[bin] = (real[bin] ?? 0) * gain;
        imaginary[bin] = (imaginary[bin] ?? 0) * gain;
      }
    }
  }
}

/** The profile of a linked set: at each bin, `√Σ N̄_c²` over its channels. */
function linkedProfile(profile: readonly Float64Array[], bins: number): Float64Array {
  const linked = new Float64Array(bins);
  for (const set of profile) {
    for (let bin = 0; bin < bins; bin += 1) {
      linked[bin] = (linked[bin] ?? 0) + (set[bin] ?? 0) * (set[bin] ?? 0);
    }
  }
  return linked.map((sum) => Math.sqrt(sum));
}
