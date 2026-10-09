/**
 * Measures the filter tests hold their processors to: a response computed
 * from coefficients by complex arithmetic, a response measured from an
 * impulse response by the canonical FFT, and the gain a processor gives a
 * sine; and the parametric equaliser's values that turn a band on, which its
 * tests and its properties share.
 */

import {
  FIRST_ORDER_AMBIX,
  StandardLayouts,
  ambisonicLayout,
  type ChannelLayout,
  type ParameterValue,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { sine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import { TEST_RATE, runProcessor } from './index.js';
import type { BiquadCascade } from '../filters/biquad.js';

/**
 * The radius of the pole pair of an Audio EQ Cookbook section at `frequency`
 * and `q` at the test rate, whose denominator is `1 + α·k`, `−2·cos ω₀`,
 * `1 − α·k` with `α = sin ω₀ / 2Q` (`k` 1, or `1/A` for a peaking section): a
 * pair that rings has the product `a₂`, so the radius `√((1 − α·k)/(1 + α·k))`.
 * Written from the cookbook, apart from the design code.
 */
export function cookbookPoleRadius(frequency: number, q: number, k = 1): number {
  const alpha = (Math.sin((2 * Math.PI * frequency) / TEST_RATE) / (2 * q)) * k;
  return Math.sqrt((1 - alpha) / (1 + alpha));
}

/**
 * The layouts every filter here is run over: each takes any layout and
 * treats every channel alike, a first-order ambisonic set among them.
 */
export const EVERY_LAYOUT: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.surround5_1,
  expectSuccess(ambisonicLayout(FIRST_ORDER_AMBIX)),
];

/** The coefficients a section holds: b0, b1, b2, a1, a2. */
const SECTION = 5;

/** `20·log₁₀` of a magnitude. */
export function decibels(magnitude: number): number {
  return 20 * Math.log10(magnitude);
}

/**
 * The magnitude of the response of every section of `coefficients` at `turns`
 * of the rate: the product over the sections of the numerator's magnitude,
 * `|b0 + b1·z⁻¹ + b2·z⁻²|`, over the denominator's, `|1 + a1·z⁻¹ + a2·z⁻²|`,
 * at `z⁻¹ = e^(−2πi·turns)`.
 */
export function analyticMagnitude(coefficients: Float64Array, turns: number): number {
  const omega = 2 * Math.PI * turns;
  const [c1, s1, c2, s2] = [
    Math.cos(omega),
    Math.sin(omega),
    Math.cos(2 * omega),
    Math.sin(2 * omega),
  ];
  let magnitude = 1;
  for (let at = 0; at < coefficients.length; at += SECTION) {
    const [b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0] = coefficients.subarray(at, at + SECTION);
    const numerator = Math.hypot(b0 + b1 * c1 + b2 * c2, b1 * s1 + b2 * s2);
    const denominator = Math.hypot(1 + a1 * c1 + a2 * c2, a1 * s1 + a2 * s2);
    magnitude *= numerator / denominator;
  }
  return magnitude;
}

/** The response of channel 0 of `cascade` to a unit impulse, `length` frames of it, in f64. */
export function cascadeImpulse(cascade: BiquadCascade, length: number): Float64Array {
  const input = new Float32Array(length);
  input[0] = 1;
  const output = new Float64Array(length);
  cascade.run(0, input, 0, length, output, 0);
  return output;
}

/** The magnitude of each bin of the canonical FFT of `signal`, whose length is a power of two. */
export function binMagnitudes(signal: Float32Array | Float64Array): Float64Array {
  const fft = expectSuccess(REFERENCE_DSP.createFft(signal.length));
  const real = new Float64Array(fft.bins);
  const imaginary = new Float64Array(fft.bins);
  fft.forwardReal(signal, real, imaginary);
  fft.release();
  return real.map((part, bin) => Math.hypot(part, imaginary[bin] ?? 0));
}

/**
 * The last frame of a response louder than 120 dB below its peak: where it
 * has decayed to silence, which a lead-in must reach.
 */
export function lastAudibleFrame(response: Float32Array | Float64Array): number {
  let peak = 0;
  for (const sample of response) peak = Math.max(peak, Math.abs(sample));
  return response.findLastIndex((sample) => Math.abs(sample) > peak * 1e-6);
}

/** The root mean square of `samples` from `from` to the end. */
function rms(samples: Float32Array, from: number): number {
  let sum = 0;
  for (let frame = from; frame < samples.length; frame += 1) sum += (samples[frame] ?? 0) ** 2;
  return Math.sqrt(sum / (samples.length - from));
}

/**
 * The gain in decibels `type` at `values` gives a mono sine of `frequency`
 * and `amplitude`, measured over the second half of `seconds` of it, once
 * the filter has settled: a whole number of cycles for any frequency that
 * divides the rate.
 */
export function sineGain(
  type: ProcessorType,
  values: Readonly<Record<string, ParameterValue>>,
  frequency: number,
  seconds = 1,
  amplitude = 0.25,
): number {
  const length = TEST_RATE * seconds;
  const input = sine(frequency, { amplitude, length }).channels[0] ?? new Float32Array(0);
  const [output] = runProcessor(type, { layout: StandardLayouts.mono, values }, [input]);
  return decibels(rms(output ?? input, length / 2) / rms(input, length / 2));
}

/**
 * The parametric equaliser's values that turn band `band` on, with `rest` of
 * its parameters by their names within the band.
 */
export function bandOn(
  band: number,
  rest: Readonly<Record<string, ParameterValue>> = {},
): Readonly<Record<string, ParameterValue>> {
  const values: Record<string, ParameterValue> = { [`band-${String(band)}-on`]: true };
  for (const [name, value] of Object.entries(rest)) values[`band-${String(band)}-${name}`] = value;
  return values;
}
