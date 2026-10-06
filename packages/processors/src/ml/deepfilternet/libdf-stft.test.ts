import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';

import { emptySpectrum } from '../spectrum.js';
import { BINS, HOP } from './deepfilternet-model.js';
import { LibDfStft, StftTransform } from './libdf-stft.js';

describe("libDF's analysis and synthesis", () => {
  it("give a signal back one hop late, the Vorbis window's squares summing to one", () => {
    const transform = new StftTransform(REFERENCE_DSP);
    const stft = new LibDfStft(transform);
    const hops = 12;
    const input = Float64Array.from({ length: hops * HOP }, (_, n) =>
      Math.fround(((n * 37) % 101) / 101 - 0.5),
    );
    const output = new Float64Array(hops * HOP);
    const spectrum = emptySpectrum(BINS);
    for (let hop = 0; hop < hops; hop += 1) {
      stft.analyse(input.subarray(hop * HOP, (hop + 1) * HOP), spectrum);
      stft.synthesise(spectrum, output.subarray(hop * HOP, (hop + 1) * HOP));
    }
    transform.release();
    let largest = 0;
    for (let n = HOP; n < hops * HOP; n += 1) {
      largest = Math.max(largest, Math.abs((output[n] ?? 0) - (input[n - HOP] ?? 0)));
    }
    expect(largest).toBeLessThan(1e-14);
  });

  it('window and scale a frame as libDF does', () => {
    // libDF scales the analysis by 2·hop/N² = 1/960, so a sine of amplitude
    // 1 centred on a bin reads half the window's sum there, over 960.
    let windowSum = 0;
    for (let n = 0; n < 960; n += 1) {
      const sine = Math.sin((Math.PI * (n + 0.5)) / 960);
      windowSum += Math.sin((Math.PI / 2) * sine * sine);
    }
    const transform = new StftTransform(REFERENCE_DSP);
    const stft = new LibDfStft(transform);
    const spectrum = emptySpectrum(BINS);
    const tone = (from: number) =>
      Float64Array.from({ length: HOP }, (_, n) => Math.sin((2 * Math.PI * 10 * (from + n)) / 960));
    stft.analyse(tone(0), spectrum);
    stft.analyse(tone(HOP), spectrum);
    transform.release();
    expect(Math.hypot(spectrum.real[10] ?? 0, spectrum.imaginary[10] ?? 0)).toBeCloseTo(
      windowSum / 2 / 960,
      12,
    );
  });
});
