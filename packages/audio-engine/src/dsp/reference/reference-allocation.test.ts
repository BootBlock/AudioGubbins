/**
 * The reference path's FFT and scalar primitives allocate nothing per call.
 *
 * Where WebAssembly is refused, the audio thread runs these: a processor calls
 * an exponential or a logarithm per sample and an FFT per block. The two-part
 * arithmetic inside them hands its pairs through arrays made once, never a
 * tuple per call, and this holds them to it. How an allocation is measured is
 * in `testing/allocation.ts`.
 */

import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { QUANTA, allocatedBy } from '../../testing/allocation.js';
import { decibelsToGain, gainToDecibels } from './decibels.js';
import { exp } from './exponential.js';
import { ln, log10, log2 } from './logarithm.js';
import { pow } from './power.js';
import { REFERENCE_DSP } from './reference-dsp.js';
import { arctangentTurns, cosineOfTurns, tangentOfTurns } from './trigonometry.js';

/** The frames of one render quantum. */
const FRAMES = 128;

describe('the reference path allocates nothing per call', () => {
  it('transforming a block to its spectrum and back', () => {
    const fft = expectSuccess(REFERENCE_DSP.createFft(256));
    const signal = new Float32Array(256).fill(0.5);
    const real = new Float64Array(fft.bins);
    const imaginary = new Float64Array(fft.bins);

    const allocated = allocatedBy({
      quantum: () => {
        fft.forwardReal(signal, real, imaginary);
        fft.inverseReal(real, imaginary, signal);
      },
    });

    fft.release();
    expect(real[0]).toBe(128);
    expect(allocated).toBeLessThan(QUANTA);
  });

  // Each its own function literal, so each call site sees one primitive, as a
  // kernel's does: one site shared by them all would see many, and V8 would
  // then call them unoptimised, boxing every result whatever the primitive.
  const input = Float64Array.from({ length: FRAMES }, (_, index) => (index + 1) / 37);
  const output = new Float64Array(FRAMES);
  it.each([
    [
      'exp',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = exp(input[i] ?? 0);
      },
    ],
    [
      'ln',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = ln(input[i] ?? 0);
      },
    ],
    [
      'log2',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = log2(input[i] ?? 0);
      },
    ],
    [
      'log10',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = log10(input[i] ?? 0);
      },
    ],
    [
      'pow',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = pow(input[i] ?? 0, 1.7);
      },
    ],
    [
      'decibelsToGain',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = decibelsToGain(-(input[i] ?? 0));
      },
    ],
    [
      'gainToDecibels',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = gainToDecibels(input[i] ?? 0);
      },
    ],
    [
      'cosineOfTurns',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = cosineOfTurns(input[i] ?? 0);
      },
    ],
    [
      'tangentOfTurns',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = tangentOfTurns(input[i] ?? 0);
      },
    ],
    [
      'arctangentTurns',
      () => {
        for (let i = 0; i < FRAMES; i += 1) output[i] = arctangentTurns(input[i] ?? 0, 0.5);
      },
    ],
  ] as const)('computing %s for a quantum of samples', (_name, quantum) => {
    const allocated = allocatedBy({ quantum });

    expect(Number.isFinite(output[5])).toBe(true);
    expect(allocated).toBeLessThan(QUANTA);
  });
});
