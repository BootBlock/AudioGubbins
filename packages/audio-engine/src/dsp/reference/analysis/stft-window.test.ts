import { beforeAll, describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../../../testing/dsp-module.js';
import { StftWindow } from '../../canonical-analysis.js';
import type { CanonicalDsp } from '../../canonical-dsp.js';
import { wasmDsp } from '../../wasm/wasm-dsp.js';
import { REFERENCE_DSP } from '../reference-dsp.js';
import { stftWindowWeights } from './stft.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe('the weights of the canonical STFT’s windows', () => {
  it.each([StftWindow.Hann, StftWindow.BlackmanHarris])(
    'are, bit for bit, the %s window the WebAssembly STFT weights its frames with',
    (window) => {
      // The STFT of a frame of ones is the transform of its window: the two
      // spectra are the same bits only if every weight is.
      const size = 1_024;
      const stft = expectSuccess(wasm.createStft({ channels: 1, size, hop: size, window }));
      stft.push([new Float32Array(size).fill(1)]);
      const stftReal = new Float64Array(size / 2 + 1);
      const stftImaginary = new Float64Array(size / 2 + 1);
      expect(stft.pullComplex(stftReal, stftImaginary)).toBe(true);
      stft.release();
      const fft = expectSuccess(REFERENCE_DSP.createFft(size));
      const real = new Float64Array(size / 2 + 1);
      const imaginary = new Float64Array(size / 2 + 1);
      fft.forwardReal(stftWindowWeights(window, size), real, imaginary);
      fft.release();
      expect(real).toEqual(stftReal);
      expect(imaginary).toEqual(stftImaginary);
    },
  );

  it('are periodic at a length that is not a power of two: near zero first, one at the middle, symmetric', () => {
    const weights = stftWindowWeights(StftWindow.BlackmanHarris, 1_000);
    expect(weights).toHaveLength(1_000);
    expect(weights[0]).toBeCloseTo(0.00006, 5);
    expect(weights[500]).toBeCloseTo(1, 12);
    expect(weights[250]).toBe(weights[750]);
    expect(weights[1]).toBe(weights[999]);
  });
});
