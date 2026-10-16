/**
 * The periodic four-term Blackman–Harris window of any length (ADR-0080), by
 * the rule the canonical STFT weights its frames with: each cosine
 * `cosineOfTurns(((k · n) mod N) / N)`, an exact argument, and the terms summed
 * left to right, `a0 − a1 · c1 + a2 · c2 − a3 · c3` (ADR-0032).
 *
 * The STFT keeps its window to itself and takes only powers of two; a loop's DC
 * means and phase projections are weighted over spans of any length, so the
 * analysis states the same rule for them, and a test holds the two equal at a
 * power of two.
 */

import { cosineOfTurns } from '@audiogubbins/audio-engine';

/** The four terms, `a0` first. */
const TERMS = [0.35875, 0.48829, 0.14128, 0.01168] as const;

/** `cos(2π · harmonic · n / size)`, the turns reduced exactly to `[0, 1)`. */
function cosineOf(harmonic: number, n: number, size: number): number {
  return cosineOfTurns(((harmonic * n) % size) / size);
}

/** The window's `size` weights. */
export function blackmanHarrisWindow(size: number): Float64Array {
  const [a0, a1, a2, a3] = TERMS;
  const weights = new Float64Array(size);
  for (let n = 0; n < size; n += 1) {
    weights[n] =
      a0 - a1 * cosineOf(1, n, size) + a2 * cosineOf(2, n, size) - a3 * cosineOf(3, n, size);
  }
  return weights;
}
