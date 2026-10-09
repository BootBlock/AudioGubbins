import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';

import { emptySpectrum } from '../spectrum.js';
import { MaskedStft } from './masked-stft.js';
import { BINS, FRAME, HOP, framesOf } from './mossformer2-model.js';

/** Seven frames' worth of a signal with energy in every bin, as single-precision samples. */
const SAMPLES = FRAME + 6 * HOP;

function signal(): Float32Array {
  return Float32Array.from(
    { length: SAMPLES },
    (_, n) => ((n * 7_919) % 211) / 211 - 0.5 + 0.3 * Math.sin(n / 13),
  );
}

function largest(values: ArrayLike<number>, against: (index: number) => number): number {
  let most = 0;
  for (let index = 0; index < values.length; index += 1) {
    most = Math.max(most, Math.abs((values[index] ?? 0) - against(index)));
  }
  return most;
}

/** A mask of `gain` for every bin of every frame of the signal. */
function maskOf(gain: (bin: number) => number): Float32Array {
  const frames = framesOf(SAMPLES);
  return Float32Array.from({ length: frames * BINS }, (_, at) => gain(at % BINS));
}

// The masked round trip runs the 1,920-point STFT over the whole signal on the
// reference DSP: about a second alone, and past the default budget under the
// whole suite's load.
describe("MossFormer2 SE 48K's masked spectrum", { timeout: 30_000 }, () => {
  it('takes each frame’s spectrum through the symmetric Hamming window, by its definition', () => {
    const segment = signal();
    const stft = new MaskedStft(REFERENCE_DSP, SAMPLES);
    const { real, imaginary } = emptySpectrum(BINS);
    stft.spectrum(segment, 3, { real, imaginary });
    stft.release();
    const windowed = Array.from(
      { length: FRAME },
      (_, n) =>
        (segment[3 * HOP + n] ?? 0) * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (FRAME - 1))),
    );
    const direct = (bin: number, part: 'real' | 'imaginary') =>
      windowed.reduce((sum, sample, n) => {
        const angle = (2 * Math.PI * ((bin * n) % FRAME)) / FRAME;
        return sum + sample * (part === 'real' ? Math.cos(angle) : -Math.sin(angle));
      }, 0);
    expect(largest(real, (bin) => direct(bin, 'real'))).toBeLessThan(1e-10);
    expect(largest(imaginary, (bin) => direct(bin, 'imaginary'))).toBeLessThan(1e-10);
  });

  it('gives the segment back, its edges too, where the mask is one everywhere', () => {
    const segment = signal();
    const stft = new MaskedStft(REFERENCE_DSP, SAMPLES);
    const made = new Float64Array(SAMPLES);
    stft.masked(
      segment,
      maskOf(() => 1),
      made,
    );
    stft.release();
    expect(largest(made, (n) => segment[n] ?? 0)).toBeLessThan(1e-13);
  });

  it('masks each frame and bin by its own gain, as torch.istft makes the segment again', () => {
    const segment = signal();
    const frames = framesOf(SAMPLES);
    const mask = Float32Array.from({ length: frames * BINS }, (_, at) => ((at * 37) % 101) / 50);
    const stft = new MaskedStft(REFERENCE_DSP, SAMPLES);
    const made = new Float64Array(SAMPLES);
    stft.masked(segment, mask, made);
    stft.release();
    // By the definition: each frame's one-sided spectrum masked, its inverse
    // the sum over the whole conjugate-symmetric spectrum over N, windowed,
    // overlapped and added, and divided by the sum of the squared windows.
    const window = (n: number) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (FRAME - 1));
    const sum = new Float64Array(SAMPLES);
    const envelope = new Float64Array(SAMPLES);
    for (let frame = 0; frame < frames; frame += 1) {
      const real = new Float64Array(BINS);
      const imaginary = new Float64Array(BINS);
      for (let bin = 0; bin < BINS; bin += 1) {
        for (let n = 0; n < FRAME; n += 1) {
          const angle = (2 * Math.PI * ((bin * n) % FRAME)) / FRAME;
          const sample = (segment[frame * HOP + n] ?? 0) * window(n);
          real[bin] = (real[bin] ?? 0) + sample * Math.cos(angle);
          imaginary[bin] = (imaginary[bin] ?? 0) - sample * Math.sin(angle);
        }
        const gain = mask[frame * BINS + bin] ?? 0;
        real[bin] = (real[bin] ?? 0) * gain;
        imaginary[bin] = (imaginary[bin] ?? 0) * gain;
      }
      for (let n = 0; n < FRAME; n += 1) {
        let value = real[0] ?? 0;
        value += (real[BINS - 1] ?? 0) * (n % 2 === 0 ? 1 : -1);
        for (let bin = 1; bin < BINS - 1; bin += 1) {
          const angle = (2 * Math.PI * ((bin * n) % FRAME)) / FRAME;
          value +=
            2 * ((real[bin] ?? 0) * Math.cos(angle) - (imaginary[bin] ?? 0) * Math.sin(angle));
        }
        const at = frame * HOP + n;
        sum[at] = (sum[at] ?? 0) + (value / FRAME) * window(n);
        envelope[at] = (envelope[at] ?? 0) + window(n) * window(n);
      }
    }
    expect(largest(made, (n) => (sum[n] ?? 0) / (envelope[n] ?? 1))).toBeLessThan(1e-11);
  });
});
