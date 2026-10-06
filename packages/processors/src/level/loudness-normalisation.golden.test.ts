import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';
import { noisySine } from '@audiogubbins/test-fixtures';

import { integratedOf, normalised, peaksOf } from '../testing/level-measures.js';
import { LOUDNESS_NORMALISATION } from './loudness-normalisation.js';

const STEREO = StandardLayouts.stereo;

/** EBU Tech 3341's test tone: `seconds` of a 1 kHz sine at `level` dBFS, the same on both channels. */
function tone(seconds: number, level: number): Float32Array[] {
  const one = Float32Array.from(
    { length: seconds * 48_000 },
    (_, frame) => decibelsToGain(level) * sineOfTurns((frame % 48) / 48),
  );
  return [one, one.slice()];
}

describe('loudness normalisation, held to a recorded render', () => {
  it('takes the EBU Tech 3341 stereo sine at −20 dBFS to −23.0 LUFS, to the recorded bits', () => {
    const input = tone(10, -20);
    const { output, measured } = normalised(LOUDNESS_NORMALISATION, { layout: STEREO }, input);
    expect(output.map((channel) => fingerprint(channel))).toEqual([
      1380495470617316005n,
      1380495470617316005n,
    ]);
    // Gated, at about −20 LUFS: a 1 kHz tone's K-weighting is nearly flat.
    expect(measured.slice(0, 3)).toEqual([48_000, 2, 1]);
    expect(Math.abs((measured[3] ?? 0) + 20)).toBeLessThan(0.1);
    expect(Math.abs(integratedOf(STEREO, output) + 23)).toBeLessThan(0.1);
  });

  it('holds noisy programme at its true-peak ceiling within 0.05 dB, to the recorded bits', () => {
    const left = noisySine(440, 4, { amplitude: 0.1 }).channels[0] ?? new Float32Array(0);
    const right = noisySine(550, 2, { amplitude: 0.1 }).channels[0] ?? new Float32Array(0);
    const values = { target: -3, 'limit-true-peak': true, ceiling: -1 };
    const { output } = normalised(LOUDNESS_NORMALISATION, { layout: STEREO, values }, [
      left,
      right,
    ]);
    expect(output.map((channel) => fingerprint(channel))).toEqual([
      6286767304323801740n,
      12183377113093646342n,
    ]);
    const { truePeak } = peaksOf(output);
    expect(truePeak).toBeLessThanOrEqual(-1 + 0.05);
    expect(truePeak).toBeGreaterThan(-1 - 0.05);
    expect(integratedOf(STEREO, output)).toBeLessThan(-3.4);
  });
});
