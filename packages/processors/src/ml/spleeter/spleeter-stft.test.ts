import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';

import { emptySpectrum } from '../spectrum.js';
import { BINS, FRAME, HOP, SYNTHESIS_SCALE } from './spleeter-model.js';
import { SpleeterStft } from './spleeter-stft.js';

/** A signal with no structure a window or a transform could hide an error in. */
function noise(length: number, seed: number): Float32Array {
  let state = seed;
  return Float32Array.from({ length }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648 - 0.5;
  });
}

describe("Spleeter's STFT", () => {
  it('transforms a frame as the definition does, under the periodic Hann window', () => {
    const stft = new SpleeterStft(REFERENCE_DSP);
    const samples = noise(FRAME + 3 * HOP, 5);
    const into = emptySpectrum(BINS);
    const start = 2 * HOP;
    stft.analyse(samples, start, into);
    stft.release();
    // Straight from the definitions, in doubles: Hann as ½ − ½·cos(2πn/N),
    // periodic, and bin k as Σ x[n]·w[n]·e^(−2πikn/N).
    for (const bin of [0, 1, 7, 512, 1023, 1024, 2047, 2048]) {
      let real = 0;
      let imaginary = 0;
      for (let n = 0; n < FRAME; n += 1) {
        const windowed =
          (samples[start + n] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / FRAME));
        const angle = (2 * Math.PI * ((bin * n) % FRAME)) / FRAME;
        real += windowed * Math.cos(angle);
        imaginary -= windowed * Math.sin(angle);
      }
      expect(into.real[bin], `bin ${String(bin)}, real`).toBeCloseTo(real, 9);
      expect(into.imaginary[bin], `bin ${String(bin)}, imaginary`).toBeCloseTo(imaginary, 9);
    }
  });

  it('gives a signal back, scaled by 2/3, wherever four frames overlap it', () => {
    const stft = new SpleeterStft(REFERENCE_DSP);
    const frames = 12;
    const length = (frames - 1) * HOP + FRAME;
    const samples = noise(length, 9);
    const synthesis = new Float64Array(length);
    const into = emptySpectrum(BINS);
    for (let frame = 0; frame < frames; frame += 1) {
      stft.analyse(samples, frame * HOP, into);
      stft.synthesise(into, synthesis, frame * HOP);
    }
    stft.release();
    let largest = 0;
    // Before the fourth frame's start, and past the last frame's first hop,
    // fewer than the four frames the scale counts on lie over a sample.
    for (let sample = FRAME - HOP; sample < frames * HOP; sample += 1) {
      const error = Math.abs((synthesis[sample] ?? 0) * SYNTHESIS_SCALE - (samples[sample] ?? 0));
      largest = Math.max(largest, error);
    }
    expect(largest).toBeLessThan(1e-12);
  });
});
