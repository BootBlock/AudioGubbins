/**
 * DeepFilterNet 3's input features, ported from libDF (`feat_erb`,
 * `feat_cplx`, `band_mean_norm_erb` and `band_unit_norm` of
 * `libDF/src/lib.rs`, DeepFilterNet, MIT or Apache-2.0, by Hendrik Schröter
 * and its contributors), as the encoder graph takes them.
 *
 * The ERB features are each band's mean power in decibels, less its running
 * mean, over 40; the complex features are the lowest 96 bins, each divided
 * by the square root of its running mean magnitude. Both running means are
 * exponential, weighted by `NORMALISATION_ALPHA`, and start where libDF
 * starts them. The encoder hears each frame's features two frames ahead
 * (`conv_lookahead`), the model's lookahead, and silence past the stream's
 * end, as DeepFilterNet's own pipeline pads them.
 *
 * Each run starts its running means afresh at its first frame, as a stream
 * starts them: the model was trained on streams that start so, and a run
 * begun part way through a stream with its means already settled was found
 * to drive it into a state it did not leave for many seconds, while a fresh
 * start settles within the warm-up (see `deepfilternet-stream.ts`).
 */

import { log10 } from '@audiogubbins/audio-engine';

import {
  DEEP_FILTER_BINS,
  ERB_BANDS,
  ERB_NORMALISATION_START,
  ERB_WIDTHS,
  FEATURE_LOOKAHEAD,
  NORMALISATION_ALPHA,
  SPECTRUM_NORMALISATION_START,
} from './deepfilternet-model.js';
import type { Spectrum } from './libdf-stft.js';

/** The weight of each frame's new value in a running mean. */
const NEW_WEIGHT = 1 - NORMALISATION_ALPHA;

/** libDF's floor under a band's power before its logarithm, keeping silence finite. */
const POWER_FLOOR = 1e-10;

/** `count` values evenly from `from` to `to`, both included, as numpy's and libDF's `linspace`. */
function linearlySpaced(from: number, to: number, count: number): Float64Array {
  const step = (to - from) / (count - 1);
  return Float64Array.from({ length: count }, (_, index) => from + index * step);
}

/** The encoder's two inputs for one run, row-major as the graph declares them. */
export interface EncoderInputs {
  /** `feat_erb`, [1, 1, frames, 32]. */
  readonly erb: Float32Array<ArrayBuffer>;
  /** `feat_spec`, [1, 2, frames, 96]: every real part, then every imaginary part. */
  readonly spectrum: Float32Array<ArrayBuffer>;
}

/** Computes a run's features with running means that start afresh at its first frame. */
export class FeatureRun {
  readonly #erbMean = new Float64Array(ERB_BANDS);
  readonly #magnitudeMean = new Float64Array(DEEP_FILTER_BINS);

  /**
   * The encoder's inputs for a run of `length` frames from `first`, frame
   * `first + s` hearing the features of frame `first + s + 2`; `spectrumAt`
   * gives each frame's spectrum, or nothing past the end of the stream, where
   * the inputs are silent.
   */
  inputs(
    spectrumAt: (frame: number) => Spectrum | undefined,
    first: number,
    length: number,
  ): EncoderInputs {
    const erb = new Float32Array(length * ERB_BANDS);
    const spectrum = new Float32Array(2 * length * DEEP_FILTER_BINS);
    this.#erbMean.set(linearlySpaced(...ERB_NORMALISATION_START, ERB_BANDS));
    this.#magnitudeMean.set(linearlySpaced(...SPECTRUM_NORMALISATION_START, DEEP_FILTER_BINS));
    for (let frame = first; frame < first + length + FEATURE_LOOKAHEAD; frame += 1) {
      const heard = spectrumAt(frame);
      if (heard === undefined) break;
      const at = frame - first - FEATURE_LOOKAHEAD;
      this.#erbFeatures(heard, at < 0 ? undefined : erb.subarray(at * ERB_BANDS));
      this.#complexFeatures(heard, spectrum, at, length);
    }
    return { erb, spectrum };
  }

  /** Updates the ERB means with `heard`, writing its features to `into` where given. */
  #erbFeatures(heard: Spectrum, into: Float32Array | undefined): void {
    let bin = 0;
    for (let band = 0; band < ERB_BANDS; band += 1) {
      const width = ERB_WIDTHS[band] ?? 0;
      const share = 1 / width;
      let power = 0;
      for (let end = bin + width; bin < end; bin += 1) {
        const real = heard.real[bin] ?? 0;
        const imaginary = heard.imaginary[bin] ?? 0;
        power += (real * real + imaginary * imaginary) * share;
      }
      const level = 10 * log10(power + POWER_FLOOR);
      const mean = level * NEW_WEIGHT + (this.#erbMean[band] ?? 0) * NORMALISATION_ALPHA;
      this.#erbMean[band] = mean;
      if (into !== undefined) into[band] = (level - mean) / 40;
    }
  }

  /** Updates the magnitude means with `heard`, writing its features at row `at` where it is one. */
  #complexFeatures(heard: Spectrum, into: Float32Array, at: number, length: number): void {
    const imaginaryBase = length * DEEP_FILTER_BINS;
    for (let bin = 0; bin < DEEP_FILTER_BINS; bin += 1) {
      const real = heard.real[bin] ?? 0;
      const imaginary = heard.imaginary[bin] ?? 0;
      const magnitude = Math.sqrt(real * real + imaginary * imaginary);
      const mean = magnitude * NEW_WEIGHT + (this.#magnitudeMean[bin] ?? 0) * NORMALISATION_ALPHA;
      this.#magnitudeMean[bin] = mean;
      if (at < 0) continue;
      const root = Math.sqrt(mean);
      into[at * DEEP_FILTER_BINS + bin] = real / root;
      into[imaginaryBase + at * DEEP_FILTER_BINS + bin] = imaginary / root;
    }
  }
}
