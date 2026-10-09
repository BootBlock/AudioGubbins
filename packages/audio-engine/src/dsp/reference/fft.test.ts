/**
 * The reference FFT is the discrete Fourier transform: it agrees with the sum
 * that defines it, its inverse undoes it, it keeps a signal's energy
 * (Parseval), and it puts a tone in its bin. The WebAssembly module is held to
 * the same bits as this one by `canonical-fft.golden.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { REFERENCE_DSP } from './reference-dsp.js';
import { sineOfTurns } from './primitives.js';

/** A seeded generator in `[−1, 1)`, so every run draws the same signal. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2_147_483_648 - 1;
  };
}

function randomSignal(size: number): Float64Array {
  const next = noise(size + 17);
  return Float64Array.from({ length: size }, () => next());
}

/** The spectrum of `signal`, `N/2 + 1` bins, by the sum that defines it, with the platform's trigonometry. */
function naive(signal: Float64Array): [Float64Array, Float64Array] {
  const size = signal.length;
  const bins = size / 2 + 1;
  const real = new Float64Array(bins);
  const imaginary = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) {
    let sumReal = 0;
    let sumImaginary = 0;
    for (let n = 0; n < size; n += 1) {
      const angle = (((k * n) % size) / size) * 2 * Math.PI;
      const sample = signal[n] ?? 0;
      sumReal += sample * Math.cos(angle);
      sumImaginary -= sample * Math.sin(angle);
    }
    real[k] = sumReal;
    imaginary[k] = sumImaginary;
  }
  return [real, imaginary];
}

function forward(signal: Float64Array): [Float64Array, Float64Array] {
  const fft = expectSuccess(REFERENCE_DSP.createFft(signal.length));
  const real = new Float64Array(fft.bins);
  const imaginary = new Float64Array(fft.bins);
  fft.forwardReal(signal, real, imaginary);
  fft.release();
  return [real, imaginary];
}

function largestDifference(left: Float64Array, right: Float64Array): number {
  let largest = 0;
  for (let index = 0; index < left.length; index += 1) {
    largest = Math.max(largest, Math.abs((left[index] ?? 0) - (right[index] ?? 0)));
  }
  return largest;
}

describe('the reference FFT', () => {
  it.each([2, 4, 8, 16, 64, 256, 1_024])('agrees with the defining sum at %s samples', (size) => {
    const signal = randomSignal(size);
    const [real, imaginary] = forward(signal);
    const [expectedReal, expectedImaginary] = naive(signal);
    // The sum's own rounding grows with the size; the FFT's grows with its log.
    expect(largestDifference(real, expectedReal)).toBeLessThan(1e-13 * size);
    expect(largestDifference(imaginary, expectedImaginary)).toBeLessThan(1e-13 * size);
    expect(imaginary[0]).toBe(0);
    expect(Math.abs(imaginary[size / 2] ?? 1)).toBe(0);
  });

  it.each([2, 16, 4_096, 65_536])('is undone by its inverse at %s samples', (size) => {
    const signal = randomSignal(size);
    const fft = expectSuccess(REFERENCE_DSP.createFft(size));
    const real = new Float64Array(fft.bins);
    const imaginary = new Float64Array(fft.bins);
    fft.forwardReal(signal, real, imaginary);
    const back = new Float64Array(size);
    fft.inverseReal(real, imaginary, back);
    fft.release();
    expect(largestDifference(back, signal)).toBeLessThan(1e-14 * Math.log2(size) + 1e-15);
  });

  it.each([8, 512, 8_192])('keeps the energy of a signal of %s samples', (size) => {
    const signal = randomSignal(size);
    const [real, imaginary] = forward(signal);
    let energy = 0;
    for (const sample of signal) energy += sample * sample;
    // Each bin but the first and last stands for itself and its mirror.
    let spectral = 0;
    for (let k = 0; k <= size / 2; k += 1) {
      const weight = k === 0 || k === size / 2 ? 1 : 2;
      spectral += weight * ((real[k] ?? 0) ** 2 + (imaginary[k] ?? 0) ** 2);
    }
    expect(Math.abs(spectral / size - energy)).toBeLessThan(1e-12 * energy);
  });

  it('puts a sine in its bin with a magnitude of half the size, and nothing elsewhere', () => {
    const size = 256;
    const signal = Float64Array.from({ length: size }, (_, n) => sineOfTurns((n * 10) / size));
    const [real, imaginary] = forward(signal);
    expect(imaginary[10]).toBeCloseTo(-128, 10);
    for (let k = 0; k < real.length; k += 1) {
      if (k !== 10) expect(Math.hypot(real[k] ?? 0, imaginary[k] ?? 0)).toBeLessThan(1e-12);
    }
  });

  it('takes the imaginary parts of the first and last bins as zero', () => {
    const fft = expectSuccess(REFERENCE_DSP.createFft(16));
    const [real, imaginary] = forward(randomSignal(16));
    const plain = new Float64Array(16);
    fft.inverseReal(real, imaginary, plain);
    imaginary[0] = 5;
    imaginary[8] = -3;
    const stray = new Float64Array(16);
    fft.inverseReal(real, imaginary, stray);
    fft.release();
    expect(stray).toEqual(plain);
  });

  it('rounds each sample once into a Float32Array', () => {
    const size = 64;
    const signal = randomSignal(size);
    const fft = expectSuccess(REFERENCE_DSP.createFft(size));
    const [real, imaginary] = forward(signal);
    const doubles = new Float64Array(size);
    const singles = new Float32Array(size);
    fft.inverseReal(real, imaginary, doubles);
    fft.inverseReal(real, imaginary, singles);
    fft.release();
    expect(singles).toEqual(Float32Array.from(doubles));
  });
});
