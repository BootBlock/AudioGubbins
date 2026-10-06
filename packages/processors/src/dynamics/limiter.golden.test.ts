import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { chirp, noisySine } from '@audiogubbins/test-fixtures';

import { TEST_RATE, processorValues, runProcessor } from '../testing/processor-run.js';
import { LIMITER } from './limiter.js';
import { firstFrame, runMono, tone, truePeakAtEightTimes } from '../testing/dynamics-runs.js';

const RATE = 48_000;

const atOversampling = (oversampling: 1 | 2 | 4 | 8) => ({
  ...MAXIMUM_QUALITY.settings,
  oversampling,
});

function declaredLatency(values: Readonly<Record<string, number>>, oversampling: 1 | 2 | 4 | 8) {
  const latency = LIMITER.descriptor.latency({
    values: processorValues(LIMITER, values),
    sampleRate: TEST_RATE,
    quality: atOversampling(oversampling),
  });
  if (latency.kind !== 'known') throw new Error('The limiter states its latency.');
  return latency.frames;
}

// The true-peak checks oversample seconds of programme eight times: about
// 2 s each alone and more than twice that under the whole suite's load, so
// they are given a budget of their own rather than Vitest's five-second
// default.
describe('the limiter, against what it states', { timeout: 30_000 }, () => {
  it('renders a fixed programme to the bits recorded for it', () => {
    const input = [
      Float32Array.from(noisySine(440).channels[0] ?? new Float32Array(0), (sample) => 3 * sample),
    ];
    const [out] = runProcessor(
      LIMITER,
      { layout: StandardLayouts.mono, values: { ceiling: -1, release: 50 } },
      input,
    );
    expect(fingerprint(out ?? new Float32Array(0))).toBe(4373760609816822602n);
  });

  it('delays a sine under its ceiling by exactly its declared latency, at every oversampling', () => {
    const input = tone(997, 0.5, RATE / 2);
    for (const oversampling of [1, 2, 4, 8] as const) {
      for (const lookAhead of [0.5, 5, 20]) {
        const values = { 'look-ahead': lookAhead };
        const delay = declaredLatency(values, oversampling);
        const out = runMono(LIMITER, values, input, atOversampling(oversampling));
        const shifted = Array.from(out.subarray(delay));
        expect(shifted).toEqual(Array.from(input.subarray(0, input.length - delay)));
        expect(out.subarray(0, delay).every((sample) => sample === 0)).toBe(true);
      }
    }
  });

  it('keeps inter-sample peaks under its ceiling at four times, measured at eight', () => {
    const ceiling = -1;
    const limit = 10 ** (ceiling / 20);
    const quality = atOversampling(4);
    // A quarter-rate sine at +6 dBFS whose samples fall 3 dB under its peaks,
    // one whose peaks fall between the detector's points, and one near the
    // top of the band the detector is stated for.
    const signals = [
      tone(RATE / 4, 2, RATE / 2, 1 / 8),
      tone(RATE / 4, 2, RATE / 2, 1 / 8 + 1 / 32),
      tone(0.42 * RATE, 2, RATE / 2, 0.07),
    ];
    for (const signal of signals) {
      expect(truePeakAtEightTimes(signal)).toBeGreaterThan(1.99);
      const out = runMono(LIMITER, { ceiling }, signal, quality);
      expect(truePeakAtEightTimes(out)).toBeLessThanOrEqual(limit);
    }
  });

  it('keeps the true peaks of loud programme under its ceiling at four and eight times', () => {
    const ceiling = -1;
    const programme = [noisySine(440).channels[0], chirp().channels[0]].map((channel) =>
      Float32Array.from(channel ?? new Float32Array(0), (sample) => 4 * sample),
    );
    for (const oversampling of [4, 8] as const) {
      const out = runProcessor(
        LIMITER,
        {
          layout: StandardLayouts.stereo,
          values: { ceiling },
          quality: atOversampling(oversampling),
        },
        programme,
      );
      for (const channel of out) {
        expect(truePeakAtEightTimes(channel)).toBeLessThanOrEqual(10 ** (ceiling / 20));
      }
    }
  });

  it('recovers from a peak with its release, to 63 % within 2 %', () => {
    const release = 500;
    const values = { ceiling: -6, release, 'look-ahead': 0.5 };
    const delay = declaredLatency(values, 1);
    // A burst at full scale, then a quiet tone the gain recovers on.
    const input = new Float32Array(3 * RATE).fill(0.01);
    input.fill(1, RATE / 2, RATE);
    const out = runMono(LIMITER, values, input, atOversampling(1));
    const gains = Float64Array.from(out, (sample, frame) => sample / (input[frame - delay] ?? 1));
    const floor = 10 ** (-6 / 20);
    const starts = firstFrame(gains, RATE + delay, (gain) => gain > floor);
    const reached = firstFrame(
      gains,
      starts,
      (gain) => gain >= floor + (1 - 1 / Math.E) * (1 - floor),
    );
    const expected = (release * RATE) / 1_000;
    expect(Math.abs(reached - starts - expected)).toBeLessThanOrEqual(0.02 * expected);
  });
});
