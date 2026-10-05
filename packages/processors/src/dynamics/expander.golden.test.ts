import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import { runProcessor } from '../testing/processor-run.js';
import { EXPANDER } from './expander.js';
import {
  appliedGain,
  firstFrame,
  rmsGainDecibels,
  runMono,
  stepped,
  tone,
} from '../testing/dynamics-runs.js';

const RATE = 48_000;

/** The expander's curve as its documentation states it, in decibels. */
function statedCurve(level: number, threshold: number, ratio: number, knee: number, range: number) {
  const over = level - threshold;
  let change = 0;
  if (2 * over <= -knee) change = (ratio - 1) * over;
  else if (2 * over < knee) change = (-(ratio - 1) * (over - knee / 2) ** 2) / (2 * knee);
  return Math.max(change, -range);
}

describe('the expander, against what it states', () => {
  it('renders a fixed programme to the bits recorded for it', () => {
    const input = [noisySine(440, 4, { amplitude: 0.05 }).channels[0] ?? new Float32Array(0)];
    const [out] = runProcessor(
      EXPANDER,
      { layout: StandardLayouts.mono, values: { threshold: -24, ratio: 3, range: 30 } },
      input,
    );
    expect(fingerprint(out ?? new Float32Array(0))).toBe(2180815151721158230n);
  });

  it('follows its static curve for a steady sine from −60 to 0 dB, within 0.05 dB', () => {
    const settings = { threshold: -30, ratio: 2.5, knee: 12, range: 40 };
    const values = { ...settings, attack: 0.1, release: 2_000 };
    const frames = 2 * RATE;
    for (let peak = -60; peak <= 0; peak += 6) {
      const input = tone(1_000, 10 ** (peak / 20), frames);
      const output = runMono(EXPANDER, values, input);
      // The peak detector reads a steady sine's peak.
      const expected = statedCurve(
        peak,
        settings.threshold,
        settings.ratio,
        settings.knee,
        settings.range,
      );
      const measured = rmsGainDecibels(input, output, frames - RATE / 2, frames);
      expect(Math.abs(measured - expected)).toBeLessThanOrEqual(0.05);
    }
  });

  it('reaches 63 % of a step in level in its attack and its release, within 2 %', () => {
    // At a threshold of 0 dB and 2:1 with no knee, the change of gain in
    // decibels is the detector level in decibels, so the gain is the level.
    const values = { threshold: 0, ratio: 2, knee: 0, range: 80, attack: 5, release: 50 };
    const at = RATE;
    const measure = (from: number, to: number, milliseconds: number) => {
      const input = stepped([from, to], at, 2 * RATE);
      const gains = appliedGain(input, runMono(EXPANDER, values, input));
      const target = from + (1 - 1 / Math.E) * (to - from);
      const reached = firstFrame(gains, at, (gain) =>
        to > from ? gain >= target : gain <= target,
      );
      const expected = (milliseconds * RATE) / 1_000;
      expect(Math.abs(reached - at + 1 - expected)).toBeLessThanOrEqual(0.02 * expected);
    };
    measure(0.01, 0.5, values.attack);
    measure(0.5, 0.01, values.release);
  });
});
