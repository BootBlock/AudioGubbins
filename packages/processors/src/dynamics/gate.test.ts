import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';

import { runProcessor } from '../testing/processor-run.js';
import { GATE } from './gate.js';
import { appliedGain, firstFrame, runMono } from '../testing/dynamics-runs.js';

const RATE = 48_000;

/** A level of `levels[i]` for `durations[i]` seconds each, one after another. */
function levels(...steps: readonly (readonly [level: number, seconds: number])[]): Float32Array {
  const signal = new Float32Array(steps.reduce((sum, [, seconds]) => sum + seconds * RATE, 0));
  let at = 0;
  for (const [level, seconds] of steps) {
    signal.fill(level, at, at + seconds * RATE);
    at += seconds * RATE;
  }
  return signal;
}

const OPEN = 10 ** (-20 / 20);
/** Between the threshold, −40 dB, and the threshold less the hysteresis, −46 dB. */
const BETWEEN = 10 ** (-43 / 20);

describe('the gate', () => {
  const values = { threshold: -40, hysteresis: 6, attack: 1, hold: 0, release: 20, range: 60 };

  it('stays closed for a level between its close and open levels when it was closed', () => {
    const input = levels([BETWEEN, 1]);
    const gains = appliedGain(input, runMono(GATE, values, input));
    expect(20 * Math.log10(gains[RATE - 1] ?? 0)).toBeCloseTo(-60, 3);
  });

  it('stays open for the same level when it was open', () => {
    const input = levels([OPEN, 0.5], [BETWEEN, 1]);
    const gains = appliedGain(input, runMono(GATE, values, input));
    expect(gains[RATE + RATE / 2 - 1]).toBe(1);
  });

  it('holds open for its hold after the level falls, then closes', () => {
    const input = levels([OPEN, 0.5], [10 ** (-80 / 20), 1]);
    const closing = (hold: number) => {
      const gains = appliedGain(input, runMono(GATE, { ...values, hold }, input));
      return firstFrame(gains, RATE / 2, (gain) => gain < 1);
    };
    // The hold starts once the key has fallen under the close level, which
    // takes the same time with or without it; 100 ms is 4,800 frames.
    expect(closing(100) - closing(0)).toBe(4_800);
  });

  it('closes to its range, and opens the whole image by its loudest channel', () => {
    const quiet = levels([10 ** (-70 / 20), 1]);
    const loud = levels([OPEN, 1]);
    const [, beside] = runProcessor(GATE, { layout: StandardLayouts.stereo, values }, [
      loud,
      quiet,
    ]);
    const [, alone] = runProcessor(GATE, { layout: StandardLayouts.stereo, values }, [
      quiet,
      quiet,
    ]);
    expect(appliedGain(quiet, beside ?? quiet)[RATE - 1]).toBe(1);
    expect(20 * Math.log10(appliedGain(quiet, alone ?? quiet)[RATE - 1] ?? 0)).toBeCloseTo(-60, 3);
  });
});
