import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import { runProcessor } from '../testing/processor-run.js';
import { GATE } from './gate.js';
import {
  appliedGain,
  firstFrame,
  rmsGainDecibels,
  runMono,
  stepped,
  tone,
} from '../testing/dynamics-runs.js';

const RATE = 48_000;

describe('the gate, against what it states', () => {
  it('renders a fixed programme to the bits recorded for it', () => {
    // A tone that rises through the threshold and falls back, so the gate opens and closes.
    const source = noisySine(440).channels[0] ?? new Float32Array(0);
    const input = Float32Array.from(source, (sample, frame) => {
      const envelope = Math.min(frame, source.length - frame) / (source.length / 2);
      return sample * envelope * envelope;
    });
    const [out] = runProcessor(
      GATE,
      { layout: StandardLayouts.mono, values: { threshold: -30, hold: 20, release: 40 } },
      [input],
    );
    expect(fingerprint(out ?? new Float32Array(0))).toBe(14575238895759046893n);
  });

  it('passes a steady sine over its threshold at unity and lowers one under it by its range', () => {
    const values = { threshold: -39, hysteresis: 6, range: 45 };
    const frames = RATE;
    const tail = [RATE / 2, RATE] as const;
    for (let peak = -60; peak <= 0; peak += 6) {
      const input = tone(1_000, 10 ** (peak / 20), frames);
      const measured = rmsGainDecibels(input, runMono(GATE, values, input), ...tail);
      // Starting closed, it opens only at the threshold itself.
      const expected = peak >= values.threshold ? 0 : -values.range;
      expect(Math.abs(measured - expected)).toBeLessThanOrEqual(0.05);
    }
  });

  it('opens in its attack and closes in its release, to 63 % within 2 %', () => {
    const range = 60;
    const floor = 10 ** (-range / 20);
    const values = { threshold: -40, hysteresis: 6, attack: 10, hold: 0, release: 100, range };
    const at = RATE / 2;
    const expected = (milliseconds: number) => (milliseconds * RATE) / 1_000;

    const opening = stepped([0, 0.5], at, RATE);
    const opened = appliedGain(opening, runMono(GATE, values, opening));
    const reachedOpen = firstFrame(
      opened,
      at,
      (gain) => gain >= floor + (1 - 1 / Math.E) * (1 - floor),
    );
    expect(Math.abs(reachedOpen - at + 1 - expected(values.attack))).toBeLessThanOrEqual(
      0.02 * expected(values.attack),
    );

    // The gate closes once its key falls under the close level, after a
    // fall of its own; the release is timed from the frame it starts.
    const closing = stepped([0.5, 0.001], at, 2 * RATE);
    const closed = appliedGain(closing, runMono(GATE, values, closing));
    const starts = firstFrame(closed, at, (gain) => gain < 1);
    const reachedClosed = firstFrame(
      closed,
      starts,
      (gain) => gain <= 1 - (1 - 1 / Math.E) * (1 - floor),
    );
    expect(Math.abs(reachedClosed - starts + 1 - expected(values.release))).toBeLessThanOrEqual(
      0.02 * expected(values.release),
    );
  });
});
