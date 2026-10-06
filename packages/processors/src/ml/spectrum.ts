/**
 * One frame's one-sided spectrum, as the machine-learning processors'
 * transforms write it and their masks and filters read it: the real and
 * imaginary parts of each bin from 0 to half the transform's length.
 */

/** A frame's spectrum, as real and imaginary parts of the same length. */
export interface Spectrum {
  readonly real: Float64Array;
  readonly imaginary: Float64Array;
}

/** A spectrum of `bins` bins of zeros, to be written. */
export function emptySpectrum(bins: number): Spectrum {
  return { real: new Float64Array(bins), imaginary: new Float64Array(bins) };
}
