/**
 * The phase mismatch of a seam at its dominant partial (the plan's metric
 * table and "The dominant partial").
 *
 * The partial is the bin of the largest Welch power of the two windows
 * summed, where it stands 20 dB above the median bin, refined to f̂ by
 * quadratic interpolation of the log powers of it and its neighbours. Each
 * window's phase is the arctangent of its Blackman–Harris-weighted projection
 * `Σ w[n] · x[n] · e^(−i2πf̂n/fs)`; the earlier window's is advanced by
 * `f̂ · distance / fs` turns, the distance being how far the later window
 * starts after it in what the engine plays, and the mismatch is the wrapped
 * difference in degrees.
 */

import { arctangentTurns, cosineOfTurns, log10, sineOfTurns } from '@audiogubbins/audio-engine';

import type { MeasuringKit } from './measuring-kit.js';
import { meanOf, powerFloor, welchPower, welchSize } from './spectral-mismatch.js';

/** How far above the median bin the dominant partial stands, as a ratio of power: 20 dB. */
const PROMINENCE = 100;

/** `turns` wrapped to `(−1/2, 1/2]`. */
function wrapTurns(turns: number): number {
  return turns - Math.ceil(turns - 0.5);
}

/** The median of `values` from `from` to `to`, the lower of two middles. */
function medianOf(values: Float64Array, from: number, to: number): number {
  const sorted = values.slice(from, to).sort();
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/**
 * The frequency in hertz of the dominant partial of windows `a` and `b`, or
 * `undefined` where none stands 20 dB above the median.
 */
export function dominantPartial(
  kit: MeasuringKit,
  a: Float32Array | Float64Array,
  b: Float32Array | Float64Array,
): number | undefined {
  const size = welchSize(Math.min(a.length, b.length));
  const power = welchPower(kit, a, size);
  const other = welchPower(kit, b, size);
  for (let bin = 0; bin < power.length; bin += 1)
    power[bin] = (power[bin] ?? 0) + (other[bin] ?? 0);
  // Bin 0 is the DC mismatch's and the last bin has no neighbour above it.
  const last = power.length - 1;
  let peak = 1;
  for (let bin = 2; bin < last; bin += 1) if ((power[bin] ?? 0) > (power[peak] ?? 0)) peak = bin;
  const median = Math.max(medianOf(power, 1, last), powerFloor(size));
  if (last < 3 || (power[peak] ?? 0) <= PROMINENCE * median) return undefined;
  const below = 10 * log10(Math.max(power[peak - 1] ?? 0, powerFloor(size)));
  const at = 10 * log10(power[peak] ?? 0);
  const above = 10 * log10(Math.max(power[peak + 1] ?? 0, powerFloor(size)));
  const curvature = below - 2 * at + above;
  const offset = curvature === 0 ? 0 : (0.5 * (below - above)) / curvature;
  return ((peak + offset) * kit.sampleRate) / size;
}

/** The phase in turns of `samples` less their mean at `frequency`, by its Blackman–Harris-weighted projection. */
function projectedPhase(
  kit: MeasuringKit,
  samples: Float32Array | Float64Array,
  frequency: number,
): number {
  const weights = kit.window(samples.length);
  const step = frequency / kit.sampleRate;
  const mean = meanOf(samples);
  let real = 0;
  let imaginary = 0;
  for (let n = 0; n < samples.length; n += 1) {
    const turns = step * n;
    const reduced = turns - Math.floor(turns);
    const weighted = (weights[n] ?? 0) * ((samples[n] ?? 0) - mean);
    real += weighted * cosineOfTurns(reduced);
    imaginary -= weighted * sineOfTurns(reduced);
  }
  return arctangentTurns(imaginary, real);
}

/**
 * The phase mismatch in degrees between `a` and `b` at `frequency`, `b`
 * starting `distance` frames after `a` in what the engine plays.
 */
export function phaseMismatch(
  kit: MeasuringKit,
  a: Float32Array | Float64Array,
  b: Float32Array | Float64Array,
  frequency: number,
  distance: number,
): number {
  const advanced = projectedPhase(kit, a, frequency) + (frequency * distance) / kit.sampleRate;
  return Math.abs(wrapTurns(projectedPhase(kit, b, frequency) - advanced)) * 360;
}
