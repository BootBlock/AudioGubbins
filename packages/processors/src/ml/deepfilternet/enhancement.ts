/**
 * What DeepFilterNet 3 makes of a frame's noisy spectrum from its graphs'
 * gains and taps, ported from DeepFilterNet's own pipeline (`DfNet.forward`
 * of `df/deepfilternet3.py`, `df` of `df/multiframe.py`, and `post_filter`
 * and the attenuation limit of `libDF/src/lib.rs` and `libDF/src/tract.rs`;
 * DeepFilterNet, MIT or Apache-2.0, by Hendrik Schröter and its
 * contributors):
 *
 * 1. Every bin is scaled by its ERB band's gain.
 * 2. The lowest 96 bins are replaced by the deep filter: the sum, over the
 *    noisy spectra of the frame two before to the frame two after (silence
 *    outside the stream), of each times its complex tap.
 * 3. Where the post-filter is on, each bin is scaled by Valin's
 *    `(1 + β)·g / (1 + β·(g / g·sin(πg/2))²) / g`, `g` being the bin's
 *    enhanced magnitude over its noisy magnitude, held between 10⁻¹² and 1,
 *    which deepens the attenuation where `g` is small.
 * 4. Where an attenuation limit is set, the noisy spectrum is mixed back in
 *    at its linear gain `l`: `(1 − l)·enhanced + l·noisy`, so the noise is
 *    lowered by at most the limit.
 *
 * libDF's real-time driver also skips frames by the encoder's local SNR
 * estimate to save work; that is no part of the model's output, and the
 * offline pipeline this follows runs every frame.
 */

import { sineOfTurns } from '@audiogubbins/audio-engine';

import {
  BINS,
  DEEP_FILTER_BINS,
  DEEP_FILTER_LOOKAHEAD,
  DEEP_FILTER_ORDER,
  ERB_BANDS,
  ERB_WIDTHS,
} from './deepfilternet-model.js';
import type { Spectrum } from '../spectrum.js';

/** How the enhanced spectrum is finished. */
export interface Finishing {
  /** The post-filter's β, or nothing where it is off. */
  readonly postFilter: number | undefined;
  /** The attenuation limit's linear gain, or nothing where there is no limit. */
  readonly limit: number | undefined;
}

/** The smallest gain the post-filter takes, libDF's `eps`. */
const SMALLEST_GAIN = 1e-12;

/** The bin each ERB band starts at. */
const BAND_STARTS: readonly number[] = ERB_WIDTHS.map((_, band) =>
  ERB_WIDTHS.slice(0, band).reduce((sum, width) => sum + width, 0),
);

/**
 * Writes to `into` the enhanced spectrum of the frame whose noisy spectra
 * from two before to two after `noisyAt` gives (offsets −2 to 2), from its
 * band gains, `gains` from `gainsAt`, and its taps, `taps` from `tapsAt`.
 */
export function enhanceFrame(
  noisyAt: (offset: number) => Spectrum | undefined,
  gains: Float32Array,
  gainsAt: number,
  taps: Float32Array,
  tapsAt: number,
  finishing: Finishing,
  into: Spectrum,
): void {
  const noisy = noisyAt(0);
  if (noisy === undefined) throw new Error('A frame is enhanced from its own spectrum.');
  for (let band = 0; band < ERB_BANDS; band += 1) {
    const gain = gains[gainsAt + band] ?? 0;
    const start = BAND_STARTS[band] ?? 0;
    for (let bin = start; bin < start + (ERB_WIDTHS[band] ?? 0); bin += 1) {
      into.real[bin] = (noisy.real[bin] ?? 0) * gain;
      into.imaginary[bin] = (noisy.imaginary[bin] ?? 0) * gain;
    }
  }
  into.real.fill(0, 0, DEEP_FILTER_BINS);
  into.imaginary.fill(0, 0, DEEP_FILTER_BINS);
  for (let tap = 0; tap < DEEP_FILTER_ORDER; tap += 1) {
    const heard = noisyAt(tap - (DEEP_FILTER_ORDER - 1 - DEEP_FILTER_LOOKAHEAD));
    if (heard === undefined) continue;
    for (let bin = 0; bin < DEEP_FILTER_BINS; bin += 1) {
      const at = tapsAt + (bin * DEEP_FILTER_ORDER + tap) * 2;
      const a = heard.real[bin] ?? 0;
      const b = heard.imaginary[bin] ?? 0;
      const c = taps[at] ?? 0;
      const d = taps[at + 1] ?? 0;
      into.real[bin] = (into.real[bin] ?? 0) + (a * c - b * d);
      into.imaginary[bin] = (into.imaginary[bin] ?? 0) + (a * d + b * c);
    }
  }
  if (finishing.postFilter !== undefined) postFilter(noisy, finishing.postFilter, into);
  if (finishing.limit !== undefined) mixBack(noisy, finishing.limit, into);
}

/** Valin's post-filter of `into`, enhanced from `noisy`, at `beta`. */
function postFilter(noisy: Spectrum, beta: number, into: Spectrum): void {
  for (let bin = 0; bin < BINS; bin += 1) {
    const real = into.real[bin] ?? 0;
    const imaginary = into.imaginary[bin] ?? 0;
    const noisyReal = noisy.real[bin] ?? 0;
    const noisyImaginary = noisy.imaginary[bin] ?? 0;
    const enhanced = Math.sqrt(real * real + imaginary * imaginary);
    const heard = Math.sqrt(noisyReal * noisyReal + noisyImaginary * noisyImaginary);
    const gain = Math.max(Math.min(enhanced / (heard + SMALLEST_GAIN), 1), SMALLEST_GAIN);
    // sin(πg/2) is the sine of g/4 turns.
    const sined = gain * sineOfTurns(gain / 4);
    const ratio = gain / sined;
    const scale = ((beta + 1) * gain) / (1 + beta * ratio * ratio) / gain;
    into.real[bin] = real * scale;
    into.imaginary[bin] = imaginary * scale;
  }
}

/** Mixes `noisy` back into `into` at the linear gain `limit`. */
function mixBack(noisy: Spectrum, limit: number, into: Spectrum): void {
  const kept = 1 - limit;
  for (let bin = 0; bin < BINS; bin += 1) {
    into.real[bin] = (into.real[bin] ?? 0) * kept + (noisy.real[bin] ?? 0) * limit;
    into.imaginary[bin] = (into.imaginary[bin] ?? 0) * kept + (noisy.imaginary[bin] ?? 0) * limit;
  }
}
