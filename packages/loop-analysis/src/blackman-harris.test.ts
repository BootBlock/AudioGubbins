import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP, StftWindow } from '@audiogubbins/audio-engine';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { blackmanHarrisWindow } from './blackman-harris.js';

describe('the Blackman–Harris window of any length', () => {
  it("is the canonical STFT's window, bit for bit, at a power of two", () => {
    // The STFT of a frame of ones is the transform of its window: the two
    // spectra are the same bits only if every weight is.
    const size = 1_024;
    const stft = expectSuccess(
      REFERENCE_DSP.createStft({ channels: 1, size, hop: size, window: StftWindow.BlackmanHarris }),
    );
    stft.push([new Float32Array(size).fill(1)]);
    const stftReal = new Float64Array(size / 2 + 1);
    const stftImaginary = new Float64Array(size / 2 + 1);
    expect(stft.pullComplex(stftReal, stftImaginary)).toBe(true);
    stft.release();
    const fft = expectSuccess(REFERENCE_DSP.createFft(size));
    const real = new Float64Array(size / 2 + 1);
    const imaginary = new Float64Array(size / 2 + 1);
    fft.forwardReal(blackmanHarrisWindow(size), real, imaginary);
    fft.release();
    expect(real).toEqual(stftReal);
    expect(imaginary).toEqual(stftImaginary);
  });

  it('is periodic: zero-ish at the first weight, one at the middle, symmetric about it', () => {
    const weights = blackmanHarrisWindow(1_000);
    expect(weights[0]).toBeCloseTo(0.00006, 5);
    expect(weights[500]).toBeCloseTo(1, 12);
    expect(weights[250]).toBe(weights[750]);
  });
});
