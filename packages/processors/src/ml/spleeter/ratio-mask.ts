/**
 * What Spleeter makes of a frame's mixed spectrum from its graph's
 * estimates, ported from `_build_manual_output_waveform` and `_extend_mask`
 * of `spleeter/model/__init__.py` (Spleeter, MIT, by Deezer), with the
 * `separation_exponent` of 2 and the `mask_extension` of `zeros` that both
 * models' configurations set:
 *
 * - each of bins 0 to 1023 of a stem is scaled by the stem's ratio mask,
 *   `(e² + ε/n) / (Σe² + ε)`, `e` the stem's estimated magnitude, the sum over
 *   the `n` stems' and ε 10⁻¹⁰, so the masks of every stem sum to one;
 * - every bin from 1024 up, above 11 kHz, which the graph does not hear, is
 *   given a mask of zero, so no stem holds anything there.
 *
 * Spleeter's own option for multichannel Wiener filtering is off in both
 * models' configurations and is not ported.
 */

import { BINS, MASK_EPSILON, MODEL_BINS } from './spleeter-model.js';
import type { Spectrum } from '../spectrum.js';

/**
 * Scales `spectrum` by stem `stem`'s ratio mask, from each stem's estimates
 * of the frame's bins, which start at `at` in every array of `estimates`.
 */
export function applyRatioMask(
  estimates: readonly Float32Array[],
  at: number,
  stem: number,
  spectrum: Spectrum,
): void {
  const chosen = estimates[stem];
  if (chosen === undefined)
    throw new Error(`A model of ${String(estimates.length)} stems has no stem ${String(stem)}.`);
  const share = MASK_EPSILON / estimates.length;
  for (let bin = 0; bin < MODEL_BINS; bin += 1) {
    let sum = 0;
    for (const estimate of estimates) {
      const value = estimate[at + bin] ?? 0;
      sum += value * value;
    }
    const value = chosen[at + bin] ?? 0;
    const mask = (value * value + share) / (sum + MASK_EPSILON);
    spectrum.real[bin] = (spectrum.real[bin] ?? 0) * mask;
    spectrum.imaginary[bin] = (spectrum.imaginary[bin] ?? 0) * mask;
  }
  spectrum.real.fill(0, MODEL_BINS, BINS);
  spectrum.imaginary.fill(0, MODEL_BINS, BINS);
}
