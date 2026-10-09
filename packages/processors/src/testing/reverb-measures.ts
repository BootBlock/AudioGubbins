/**
 * Measures the reverb's tests hold it to: the RT60 of an impulse response by
 * Schroeder's backward integration, and the correlation of two channels.
 */

import { StandardLayouts, type ParameterValue } from '@audiogubbins/domain';

import { runProcessor } from './processor-run.js';
import { REVERB } from '../space/reverb.js';

/** The reverb's mono response to a unit impulse at frame 0, `length` frames of it. */
export function reverbImpulse(
  values: Readonly<Record<string, ParameterValue>>,
  length: number,
): Float32Array {
  const impulse = new Float32Array(length);
  impulse[0] = 1;
  const [response] = runProcessor(REVERB, { layout: StandardLayouts.mono, values }, [impulse]);
  return response ?? new Float32Array(0);
}

/**
 * The seconds a response takes to fall 60 dB, measured as its T30: twice the
 * time its Schroeder energy decay curve, `10·log₁₀ Σ_(τ≥t) h(τ)²` against
 * its whole energy, takes from −5 dB to −35 dB.
 */
export function measuredRt60(response: Float32Array, rate: number): number {
  const remaining = new Float64Array(response.length + 1);
  for (let frame = response.length - 1; frame >= 0; frame -= 1) {
    remaining[frame] = (remaining[frame + 1] ?? 0) + (response[frame] ?? 0) ** 2;
  }
  const whole = remaining[0] ?? 1;
  const crossing = (decibels: number): number =>
    remaining.findIndex((energy) => 10 * Math.log10(energy / whole) <= decibels);
  return (2 * (crossing(-35) - crossing(-5))) / rate;
}

/** The normalised correlation of two channels: 1 when they are the same. */
export function correlation(left: Float32Array, right: Float32Array): number {
  let [product, leftEnergy, rightEnergy] = [0, 0, 0];
  for (const [frame, sample] of left.entries()) {
    const other = right[frame] ?? 0;
    product += sample * other;
    leftEnergy += sample * sample;
    rightEnergy += other * other;
  }
  return product / Math.sqrt(leftEnergy * rightEnergy);
}
