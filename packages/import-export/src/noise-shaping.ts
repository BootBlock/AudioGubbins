/**
 * The noise-shaping filters a dither may feed its error back through.
 *
 * Quantisation by error feedback: each sample has the filtered errors of the
 * samples before it subtracted before it is quantised, so the error added to
 * the sound is the quantiser's own filtered by `1 − H(z)`, where
 * `H(z) = Σ hₖ z⁻ᵏ` over the coefficients below, k from 1. Its power moves
 * away from where the ear is most sensitive and into where it is least.
 *
 * - `first-order`: `h = [1]`, so the error is `1 − z⁻¹`, rising 6 dB an octave
 *   toward the top of the band, at any rate.
 * - `lipshitz-e-weighted`: the nine-tap filter of S. P. Lipshitz, J. Vanderkooy
 *   and R. A. Wannamaker, "Minimally Audible Noise Shaping", J. Audio Eng. Soc.
 *   39(11), 1991, designed against the ear's E-weighting at 44.1 kHz. Its error
 *   is about 25 dB down at 3 kHz and rises above the unshaped error past about
 *   13 kHz. At another rate its curve would sit at other frequencies, so it is
 *   refused there rather than applied.
 */

import type { NoiseShaping } from './export-settings.js';

/** A filter: its coefficients `h₁ … hₙ`, and the one rate it was designed for, if one. */
interface ShapingFilter {
  readonly coefficients: readonly number[];
  readonly designedRate: number | undefined;
}

const FILTERS: Readonly<Record<NoiseShaping, ShapingFilter>> = {
  none: { coefficients: [], designedRate: undefined },
  'first-order': { coefficients: [1], designedRate: undefined },
  'lipshitz-e-weighted': {
    coefficients: [2.412, -3.37, 3.937, -4.174, 3.353, -2.205, 1.281, -0.569, 0.0847],
    designedRate: 44_100,
  },
};

/** The coefficients of a shaping's filter, `h₁` first. */
export function shapingCoefficients(shaping: NoiseShaping): readonly number[] {
  return FILTERS[shaping].coefficients;
}

/** The one rate a shaping's filter was designed for, or `undefined` where it holds at any. */
export function shapingDesignedRate(shaping: NoiseShaping): number | undefined {
  return FILTERS[shaping].designedRate;
}
