import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import { runProcessor } from '../testing/processor-run.js';
import { COMPRESSOR } from './compressor.js';
import {
  appliedGain,
  firstFrame,
  rmsGainDecibels,
  runMono,
  stepped,
  tone,
} from '../testing/dynamics-runs.js';

const RATE = 48_000;

/** The compressor's curve as its documentation states it, in decibels. */
function statedCurve(level: number, threshold: number, ratio: number, knee: number): number {
  const over = level - threshold;
  if (2 * over <= -knee) return 0;
  if (2 * over >= knee) return (1 / ratio - 1) * over;
  return ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
}

describe('the compressor, against what it states', () => {
  it('renders a fixed programme to the bits recorded for it', () => {
    const input = [noisySine(440).channels[0] ?? new Float32Array(0)];
    const [out] = runProcessor(
      COMPRESSOR,
      { layout: StandardLayouts.mono, values: { threshold: -20, ratio: 6, attack: 2 } },
      input,
    );
    expect(fingerprint(out ?? new Float32Array(0))).toBe(5531177656222552230n);
  });

  it('follows its static curve for a steady sine from −60 to 0 dB, within 0.05 dB', () => {
    const settings = { threshold: -24, ratio: 4, knee: 12 };
    const values = { ...settings, detector: 'rms', attack: 200, release: 200 };
    const frames = 3 * RATE;
    for (let peak = -60; peak <= 0; peak += 6) {
      const input = tone(1_000, 10 ** (peak / 20), frames);
      const output = runMono(COMPRESSOR, values, input);
      // A sine's RMS is its peak less 3.01 dB, and the curve reads the RMS.
      const level = peak + 20 * Math.log10(Math.SQRT1_2);
      const expected = statedCurve(level, settings.threshold, settings.ratio, settings.knee);
      // The last half second, a whole number of the tone's periods.
      const measured = rmsGainDecibels(input, output, frames - RATE / 2, frames);
      expect(Math.abs(measured - expected)).toBeLessThanOrEqual(0.05);
    }
  });

  it('reaches 63 % of a step in level in its attack and its release, within 2 %', () => {
    const threshold = -60;
    const ratio = 20;
    const values = { threshold, ratio, knee: 0, attack: 10, release: 100 };
    // The detector level a gain stands for, by the hard-knee curve inverted.
    const levelOf = (gain: number) =>
      10 ** ((threshold + (20 * Math.log10(gain)) / (1 / ratio - 1)) / 20);
    const at = RATE;
    const measure = (from: number, to: number, milliseconds: number) => {
      const input = stepped([from, to], at, 3 * RATE);
      const gains = appliedGain(input, runMono(COMPRESSOR, values, input));
      const target = from + (1 - 1 / Math.E) * (to - from);
      const reached = firstFrame(gains, at, (gain) =>
        to > from ? levelOf(gain) >= target : levelOf(gain) <= target,
      );
      const expected = (milliseconds * RATE) / 1_000;
      expect(Math.abs(reached - at + 1 - expected)).toBeLessThanOrEqual(0.02 * expected);
    };
    measure(0.01, 0.5, values.attack);
    measure(0.5, 0.01, values.release);
  });
});
