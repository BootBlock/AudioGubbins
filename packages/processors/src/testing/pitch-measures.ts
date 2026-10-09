/**
 * What the pitch shift's tests measure its output with, written with the
 * platform's arithmetic so a measure shares nothing with the kernel it
 * checks: tones made sample by sample, the frequency of the loudest partial
 * of a stretch, and a tone's amplitude and phase fitted at a frequency.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { TEST_RATE } from './processor-run.js';

/** A partial of a test tone: its frequency in hertz and its amplitude. */
export interface Partial {
  readonly frequency: number;
  readonly amplitude: number;
}

/** `length` samples of the sum of `partials`, each a sine from phase zero, at `rate`. */
export function tones(
  partials: readonly Partial[],
  length: number,
  rate: number = TEST_RATE,
): Float32Array {
  return Float32Array.from({ length }, (_, n) =>
    partials.reduce(
      (sum, { frequency, amplitude }) =>
        sum + amplitude * Math.sin((2 * Math.PI * frequency * n) / rate),
      0,
    ),
  );
}

/** The transform the frequency is read with: 2¹⁶ bins, under a hertz apart at 48 kHz. */
const MEASURE_SIZE = 65_536;

/**
 * The frequency in hertz of the loudest partial of `length` samples of
 * `signal` from `from`, under a Hann window and padded with zeros to the
 * measuring transform: the loudest bin, moved to the vertex of the parabola
 * through its log magnitude and its neighbours', which for a Hann window is
 * within a hundredth of a bin of the partial.
 */
export function loudestFrequency(
  signal: Float32Array,
  from: number,
  length: number,
  rate: number = TEST_RATE,
): number {
  const fft = expectSuccess(REFERENCE_DSP.createFft(MEASURE_SIZE));
  const frame = new Float64Array(MEASURE_SIZE);
  for (let n = 0; n < length; n += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / length);
    frame[n] = (signal[from + n] ?? 0) * hann;
  }
  const real = new Float64Array(fft.bins);
  const imaginary = new Float64Array(fft.bins);
  fft.forwardReal(frame, real, imaginary);
  fft.release();
  const level = (k: number) => Math.log(Math.hypot(real[k] ?? 0, imaginary[k] ?? 0) + 1e-300);
  let loudest = 1;
  for (let k = 1; k < fft.bins - 1; k += 1) if (level(k) > level(loudest)) loudest = k;
  const below = level(loudest - 1);
  const at = level(loudest);
  const above = level(loudest + 1);
  const vertex = (0.5 * (below - above)) / (below - 2 * at + above);
  return ((loudest + vertex) * rate) / MEASURE_SIZE;
}

/** A tone's amplitude and phase in radians, `a · sin(2πft/rate + φ)`. */
export interface FittedTone {
  readonly amplitude: number;
  readonly phase: number;
}

/**
 * The amplitude and phase of the partial at `frequency` hertz in `length`
 * samples of `signal` from `from`, fitted against its sine and cosine. Over
 * tens of thousands of samples another partial's share of the fit falls as
 * one over its distance in hertz times the length, far below what is
 * measured here.
 */
export function fittedTone(
  signal: Float32Array,
  frequency: number,
  from: number,
  length: number,
  rate: number = TEST_RATE,
): FittedTone {
  let sine = 0;
  let cosine = 0;
  for (let n = 0; n < length; n += 1) {
    const angle = (2 * Math.PI * frequency * (from + n)) / rate;
    sine += (signal[from + n] ?? 0) * Math.sin(angle);
    cosine += (signal[from + n] ?? 0) * Math.cos(angle);
  }
  return {
    amplitude: (2 * Math.hypot(sine, cosine)) / length,
    phase: Math.atan2(cosine, sine),
  };
}

/** The root mean square of `length` samples of `signal` from `from`. */
export function rootMeanSquare(signal: Float32Array, from: number, length: number): number {
  let sum = 0;
  for (let n = 0; n < length; n += 1) sum += (signal[from + n] ?? 0) ** 2;
  return Math.sqrt(sum / length);
}

/** `ratio` in decibels. */
export function decibelsOf(ratio: number): number {
  return 20 * Math.log10(ratio);
}
