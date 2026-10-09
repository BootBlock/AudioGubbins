import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { chirp, noisySine } from '@audiogubbins/test-fixtures';

import { TEST_RATE, processorValues, runProcessor } from '../testing/processor-run.js';
import { LIMITER } from './limiter.js';
import { canonicalTruePeak, firstFrame, runMono, tone } from '../testing/dynamics-runs.js';

const RATE = 48_000;

/**
 * `channel` followed by more silence than the limiter's latency, as the rack
 * runs a stream on past its end by its latency: what is heard of the end then
 * meets the silence after it, which a meter's reading of its tail reads too.
 */
function runOn(channel: Float32Array): Float32Array {
  const padded = new Float32Array(channel.length + 2_048);
  padded.set(channel);
  return padded;
}

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

// The true-peak checks run the limiter over seconds of programme at several
// rates and oversamplings: seconds alone and more than twice that under the
// whole suite's load, so they are given a budget of their own rather than
// Vitest's five-second default.
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
    expect(fingerprint(out ?? new Float32Array(0))).toBe(11393045454066888444n);
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

  it('keeps the true peak under its ceiling as the canonical meter reads it, at four and eight times', () => {
    const ceiling = -1;
    const limit = 10 ** (ceiling / 20);
    let seed = 1;
    const noise = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return (seed / 2_147_483_648) * 2 - 1;
    };
    for (const rate of [44_100, 48_000, 96_000]) {
      const frames = rate / 2;
      // A quarter-rate sine at +6 dBFS whose samples fall 3 dB under its
      // peaks, two near the top of the band, where the meter's filter reads a
      // sine above its own peak, noise over the whole band, and loud bursts of
      // a tone between quiet ones.
      const signals = [
        Float32Array.from({ length: frames }, (_, n) => 2 * Math.sin(Math.PI * (n / 2 + 1 / 4))),
        Float32Array.from({ length: frames }, (_, n) => 2 * Math.sin(2 * Math.PI * 0.43 * n + 1.1)),
        Float32Array.from({ length: frames }, (_, n) => 4 * Math.sin(2 * Math.PI * 0.45 * n + 0.3)),
        Float32Array.from({ length: frames }, () => 3 * noise()),
        Float32Array.from(
          { length: frames },
          (_, n) =>
            (Math.floor(n / 500) % 2 === 1 ? 4 : 0.05) * Math.sin(2 * Math.PI * 0.23 * n + 0.7),
        ),
      ];
      for (const signal of signals) {
        expect(canonicalTruePeak([signal], rate)).toBeGreaterThan(1.99);
        for (const oversampling of [4, 8] as const) {
          const [out] = runProcessor(
            LIMITER,
            {
              layout: StandardLayouts.mono,
              values: { ceiling, 'look-ahead': 1, release: 20 },
              quality: atOversampling(oversampling),
              sampleRate: expectSuccess(sampleRate(rate)),
            },
            [runOn(signal)],
            [128, 7],
          );
          expect(canonicalTruePeak([out ?? new Float32Array(0)], rate)).toBeLessThanOrEqual(limit);
        }
      }
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
        programme.map(runOn),
      );
      expect(canonicalTruePeak(out, TEST_RATE)).toBeLessThanOrEqual(10 ** (ceiling / 20));
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
