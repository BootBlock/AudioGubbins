import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise, sine } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { advanced, learnedProfile, sineFit } from '../testing/spectral-measures.js';
import { NOISE_REDUCTION } from './noise-reduction.js';

const LENGTH = 2 * TEST_RATE;
const LATENCY = 2_047;

/** A 1 kHz sine of amplitude 0.25 in uniform white noise of amplitude 0.1: 9.7 dB SNR. */
const tone = sine(1_000, { amplitude: 0.25, length: LENGTH }).channels[0] ?? new Float32Array(0);
const hiss = noise(7, { length: LENGTH, amplitude: 0.1 }).channels[0] ?? new Float32Array(0);
const noisy = tone.map((sample, frame) => sample + (hiss[frame] ?? 0));

/** The profile, learned on other noise of the same level alone, as a person marks a stretch of it. */
const profile = learnedProfile(StandardLayouts.mono, [
  noise(2, { length: LENGTH, amplitude: 0.1 }).channels[0] ?? new Float32Array(0),
]);

const GOLDEN = { reduction: 24 } as const;

describe('noise reduction, held to a recorded render', () => {
  const [reduced = new Float32Array(0)] = runProcessor(
    NOISE_REDUCTION,
    { layout: StandardLayouts.mono, values: GOLDEN, state: profile },
    [noisy],
  );

  it('renders a sine in noise to the recorded bits', () => {
    expect(fingerprint(reduced)).toBe(2443483723116133244n);
  });

  it('raises the SNR of a sine in noise by at least 12 dB and keeps its level within 0.5 dB', () => {
    // Measured from half a second in, past the latency and the gains' settling.
    const before = sineFit(noisy, 1_000, TEST_RATE / 2, LENGTH - 4_096);
    const after = sineFit(advanced(reduced, LATENCY), 1_000, TEST_RATE / 2, LENGTH - 4_096);
    expect(after.snr - before.snr).toBeGreaterThanOrEqual(12);
    expect(Math.abs(20 * Math.log10(after.amplitude / before.amplitude))).toBeLessThan(0.5);
  });

  it('passes its input through, delayed, within 1e-6 at a reduction of 0 dB', () => {
    for (const layout of [StandardLayouts.mono, StandardLayouts.stereo]) {
      const input = layout.roles.map((_, channel) =>
        noisy.map((sample) => sample * (1 - channel / 4)),
      );
      const stretch = layout.roles.map(
        (_, channel) =>
          noise(2 + channel, { length: TEST_RATE, amplitude: 0.1 }).channels[0] ??
          new Float32Array(0),
      );
      const out = runProcessor(
        NOISE_REDUCTION,
        { layout, values: { reduction: 0 }, state: learnedProfile(layout, stretch) },
        input,
      );
      for (const [channel, samples] of out.entries()) {
        let worst = 0;
        for (let frame = 0; frame < LENGTH; frame += 1) {
          const expected = frame < LATENCY ? 0 : (input[channel]?.[frame - LATENCY] ?? 0);
          worst = Math.max(worst, Math.abs((samples[frame] ?? 0) - expected));
        }
        expect(worst).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});
