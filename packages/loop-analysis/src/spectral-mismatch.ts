/**
 * The spectral mismatch of a seam (the plan's metric table): the root mean
 * square over third-octave bands of `10 · log10(P_a ÷ P_b)`, from Welch
 * averages of the two windows a reference compares.
 *
 * A Welch average here is the canonical FFT of `N` samples, the largest power
 * of two within the window, weighted by the four-term Blackman–Harris window,
 * `N/2` apart, at least one frame, each bin's power `re² + im²` averaged over
 * the frames in order. The window is read less its mean: DC is the DC
 * metrics' to measure, and through the window's main lobe it would otherwise
 * count again in the lowest band and pass for a partial.
 *
 * A band's power is floored before the logarithm at `10⁻⁹ · N`, so two
 * silent windows compare as equal, and at the louder window's total power
 * 60 dB down, the level the DC metrics and the discontinuity also stop at: a
 * tone's empty bands hold only the window's leakage, 90 dB under it, whose
 * shape moves with the tone's phase, and compared there two windows of one
 * tone would differ by 10 dB in bands nothing is heard in.
 */

import { log10 } from '@audiogubbins/audio-engine';

import type { MeasuringKit } from './measuring-kit.js';

/** The Welch frame size for a window of `frames`: the largest power of two within it. */
export function welchSize(frames: number): number {
  let size = 1;
  while (size * 2 <= frames) size *= 2;
  return size;
}

/** The mean of `samples`, summed in order. */
export function meanOf(samples: Float32Array | Float64Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample;
  return sum / samples.length;
}

/** The floor of a band's or a bin's power for a transform of `size`. */
export function powerFloor(size: number): number {
  return 1e-9 * size;
}

/** The Welch average power of each bin of `samples` less its mean, by FFTs of `size`. */
export function welchPower(
  kit: MeasuringKit,
  samples: Float32Array | Float64Array,
  size: number,
): Float64Array {
  const fft = kit.fft(size);
  const weights = kit.window(size);
  const hop = size / 2;
  const frames = Math.floor((samples.length - size) / hop) + 1;
  const signal = new Float64Array(size);
  const real = new Float64Array(fft.bins);
  const imaginary = new Float64Array(fft.bins);
  const power = new Float64Array(fft.bins);
  const mean = meanOf(samples);
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * hop;
    for (let n = 0; n < size; n += 1) {
      signal[n] = ((samples[offset + n] ?? 0) - mean) * (weights[n] ?? 0);
    }
    fft.forwardReal(signal, real, imaginary);
    for (let bin = 0; bin < fft.bins; bin += 1) {
      const re = real[bin] ?? 0;
      const im = imaginary[bin] ?? 0;
      power[bin] = (power[bin] ?? 0) + (re * re + im * im);
    }
  }
  for (let bin = 0; bin < fft.bins; bin += 1) power[bin] = (power[bin] ?? 0) / frames;
  return power;
}

/** The share of a window's total power under which a band is floored: −60 dB. */
const AUDIBLE_SHARE = 1e-6;

/** The sum of `power` over each band. */
function bandPowers(kit: MeasuringKit, power: Float64Array, size: number): Float64Array {
  const bands = kit.bands(size);
  const powers = new Float64Array(bands.length);
  bands.forEach((band, index) => {
    let sum = 0;
    for (let bin = band.from; bin < band.to; bin += 1) sum += power[bin] ?? 0;
    powers[index] = sum;
  });
  return powers;
}

/** The sum of `powers`, in order. */
function totalOf(powers: Float64Array): number {
  let total = 0;
  for (const power of powers) total += power;
  return total;
}

/**
 * The spectral mismatch in dB of windows `a` and `b`, of one length, or
 * `undefined` where their spectrum has no band to compare.
 */
export function spectralMismatch(
  kit: MeasuringKit,
  a: Float32Array | Float64Array,
  b: Float32Array | Float64Array,
): number | undefined {
  const size = welchSize(Math.min(a.length, b.length));
  const first = bandPowers(kit, welchPower(kit, a, size), size);
  const second = bandPowers(kit, welchPower(kit, b, size), size);
  if (first.length === 0) return undefined;
  const floor = Math.max(
    powerFloor(size),
    AUDIBLE_SHARE * Math.max(totalOf(first), totalOf(second)),
  );
  let sum = 0;
  for (let band = 0; band < first.length; band += 1) {
    const difference =
      10 * log10(Math.max(first[band] ?? 0, floor) / Math.max(second[band] ?? 0, floor));
    sum += difference * difference;
  }
  return Math.sqrt(sum / first.length);
}
