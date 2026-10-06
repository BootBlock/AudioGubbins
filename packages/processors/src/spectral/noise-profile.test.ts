import { describe, expect, it } from 'vitest';

import { StandardLayouts, discreteLayout, type ProcessorState } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE, processorValues } from '../testing/processor-run.js';
import { NOISE_PROFILE_KIND } from './noise-profile.js';
import { NOISE_REDUCTION, noiseProfileLearner } from './noise-reduction.js';

/** Mono noise of `amplitude`, `length` frames of it, a profile's stretch. */
function noiseOf(amplitude: number, length: number): Float32Array[] {
  return [noise(40, { length, amplitude }).channels[0] ?? new Float32Array(0)];
}

describe('the noise profile learner', () => {
  const learn = (stretch: readonly Float32Array[], chunks: readonly number[]): ProcessorState => {
    const learner = expectSuccess(
      noiseProfileLearner({
        values: processorValues(NOISE_REDUCTION),
        input: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        dsp: REFERENCE_DSP,
      }),
    );
    const length = stretch[0]?.length ?? 0;
    for (let at = 0, turn = 0; at < length; turn += 1) {
      const frames = Math.min(chunks[turn % chunks.length] ?? 1, length - at);
      learner.add(
        stretch.map((channel) => channel.subarray(at, at + frames)),
        frames,
      );
      at += frames;
    }
    return learner.result();
  };

  it('learns the mean magnitude white noise has in every bin, by its analytic value', () => {
    const amplitude = 0.2;
    const profile = learn(noiseOf(amplitude, 2 * TEST_RATE), [4_096]);
    expect(profile.kind).toBe(NOISE_PROFILE_KIND);
    expect(profile.values.slice(0, 3)).toEqual([2_048, 48_000, 1]);
    // Uniform noise of variance a²/3 under a window whose squares sum to N/2
    // gives each bin a complex Gaussian of power σ² · N/2, of mean magnitude
    // √(π/4 · σ² · N/2).
    const expected = Math.sqrt((Math.PI / 4) * ((amplitude * amplitude) / 3) * 1_024);
    const interior = profile.values.slice(3 + 8, 3 + 1_017);
    const mean = interior.reduce((sum, value) => sum + value, 0) / interior.length;
    expect(Math.abs(mean / expected - 1)).toBeLessThan(0.02);
    for (const value of interior) expect(Math.abs(value / expected - 1)).toBeLessThan(0.25);
  });

  it('learns the same profile however the stretch is cut, and nothing from one shorter than a frame', () => {
    const stretch = noiseOf(0.1, 20_000);
    expect(learn(stretch, [1, 7, 333, 4_096])).toEqual(learn(stretch, [20_000]));
    const short = learn(noiseOf(0.1, 2_047), [2_047]);
    expect(short.values.slice(3).every((value) => value === 0)).toBe(true);
  });

  it('refuses to learn a profile larger than a processor’s state may be', () => {
    const at = (channels: number) =>
      noiseProfileLearner({
        values: processorValues(NOISE_REDUCTION, { resolution: '8192' }),
        input: expectSuccess(discreteLayout(channels)),
        sampleRate: TEST_RATE,
        dsp: REFERENCE_DSP,
      });
    expect(at(63).ok).toBe(true);
    expect(expectFailureCode(at(64))).toBe('processor.state-refused');
  });
});
