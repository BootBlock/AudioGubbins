import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';
import { noisySine } from '@audiogubbins/test-fixtures';

import { normalised, peaksOf } from '../testing/level-measures.js';
import { PEAK_NORMALISATION } from './peak-normalisation.js';

const LENGTH = 48_000;

/** `LENGTH` frames of a sine of `turns` a frame at `amplitude`, by the canonical sine. */
function tone(turns: number, amplitude: number, phase = 0): Float32Array {
  return Float32Array.from(
    { length: LENGTH },
    (_, frame) => amplitude * sineOfTurns(frame * turns + phase),
  );
}

describe('peak normalisation, held to a recorded render', () => {
  it('renders noisy stereo normalised to −3 dBTP to the recorded bits', () => {
    const left = noisySine(440).channels[0] ?? new Float32Array(0);
    const right = noisySine(660, 2, { amplitude: 0.3 }).channels[0] ?? new Float32Array(0);
    const { output, measured } = normalised(
      PEAK_NORMALISATION,
      { layout: StandardLayouts.stereo, values: { target: -3, detection: 'true-peak' } },
      [left, right],
    );
    expect(output.map((channel) => fingerprint(channel))).toEqual([
      1776788866632973399n,
      18282540813921915932n,
    ]);
    // The rate and channel count, then the linked sample and true peaks.
    expect(measured.slice(0, 2)).toEqual([48_000, 2]);
    expect(measured[3]).toBeGreaterThanOrEqual(measured[2] ?? 1);
    // What the bits are held to: the louder channel's true peak at the target.
    expect(Math.abs(peaksOf(output).truePeak + 3)).toBeLessThan(0.05);
  });

  it('takes a sine of known peak to −1 dBFS within a thousandth of a decibel', () => {
    // A hundred frames a cycle, so frame 25 is the crest: the peak is 0.3 exactly.
    const input = [tone(0.01, 0.3)];
    const { output } = normalised(
      PEAK_NORMALISATION,
      { layout: StandardLayouts.mono, values: { target: -1 } },
      input,
    );
    const peak = (output[0] ?? new Float32Array(0)).reduce(
      (most, x) => Math.max(most, Math.abs(x)),
      0,
    );
    expect(Math.abs(20 * Math.log10(peak) + 1)).toBeLessThan(0.001);
    // One gain over the whole signal: every sample in the same proportion.
    expect((output[0]?.[1_234] ?? 0) / (input[0]?.[1_234] ?? 1)).toBeCloseTo(
      10 ** (-1 / 20) / 0.3,
      5,
    );
  });

  it('takes a quarter-rate sine at 45° to −1 dBTP by the meter within 0.05 dB', () => {
    // Every sample is 3 dB under the crests between them (EBU Tech 3341 case 16).
    const input = [tone(0.25, decibelsToGain(-6), 0.125)];
    const { output } = normalised(
      PEAK_NORMALISATION,
      { layout: StandardLayouts.mono, values: { target: -1, detection: 'true-peak' } },
      input,
    );
    const { samplePeak, truePeak } = peaksOf(output);
    expect(Math.abs(truePeak + 1)).toBeLessThan(0.05);
    expect(Math.abs(samplePeak + 4.01)).toBeLessThan(0.1);
  });
});
