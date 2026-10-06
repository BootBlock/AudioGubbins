import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP, cosineOfTurns, sineOfTurns, wasmDsp } from '@audiogubbins/audio-engine';
import { dspModuleExports } from '@audiogubbins/audio-engine/testing';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { RealDft } from './real-dft.js';

const SIZE = 960;

/** A signal with energy in every bin, and at both edges of the spectrum. */
function signal(): Float64Array {
  return Float64Array.from(
    { length: SIZE },
    (_, n) => ((n * 7919) % 211) / 211 - 0.5 + 0.25 * (n % 2 === 0 ? 1 : -1) + 0.1,
  );
}

/** The spectrum by the definition, `Σ x[n]·e^(−2πikn/N)`, its angles exact in turns. */
function directSpectrum(x: Float64Array): { real: Float64Array; imaginary: Float64Array } {
  const bins = SIZE / 2 + 1;
  const real = new Float64Array(bins);
  const imaginary = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) {
    for (let n = 0; n < SIZE; n += 1) {
      const turns = ((k * n) % SIZE) / SIZE;
      real[k] = (real[k] ?? 0) + (x[n] ?? 0) * cosineOfTurns(turns);
      imaginary[k] = (imaginary[k] ?? 0) - (x[n] ?? 0) * sineOfTurns(turns);
    }
  }
  return { real, imaginary };
}

function largest(values: Float64Array, against: Float64Array): number {
  return values.reduce(
    (most, value, index) => Math.max(most, Math.abs(value - (against[index] ?? 0))),
    0,
  );
}

describe('the real DFT of 960 samples on the canonical FFT', () => {
  it('is the transform by its definition, within rounding', () => {
    const x = signal();
    const dft = RealDft.of(REFERENCE_DSP, SIZE);
    const real = new Float64Array(dft.bins);
    const imaginary = new Float64Array(dft.bins);
    dft.forward(x, real, imaginary);
    dft.release();
    const direct = directSpectrum(x);
    // The definition sums 960 products a bin; the bins reach about 120.
    expect(largest(real, direct.real)).toBeLessThan(1e-10);
    expect(largest(imaginary, direct.imaginary)).toBeLessThan(1e-10);
  });

  it('gives the signal back, times 960, from its spectrum', () => {
    const x = signal();
    const dft = RealDft.of(REFERENCE_DSP, SIZE);
    const real = new Float64Array(dft.bins);
    const imaginary = new Float64Array(dft.bins);
    const back = new Float64Array(SIZE);
    dft.forward(x, real, imaginary);
    dft.inverse(real, imaginary, back);
    dft.release();
    expect(
      largest(
        back.map((sample) => sample / SIZE),
        x,
      ),
    ).toBeLessThan(1e-13);
  });

  it('gives the same bits on the WebAssembly DSP as on the reference', async () => {
    const dsp = expectSuccess(wasmDsp(await dspModuleExports()));
    const x = signal();
    const of = (dft: RealDft) => {
      const real = new Float64Array(dft.bins);
      const imaginary = new Float64Array(dft.bins);
      dft.forward(x, real, imaginary);
      const back = new Float64Array(SIZE);
      dft.inverse(real, imaginary, back);
      dft.release();
      return [real, imaginary, back];
    };
    expect(of(RealDft.of(dsp, SIZE))).toEqual(of(RealDft.of(REFERENCE_DSP, SIZE)));
  });
});
