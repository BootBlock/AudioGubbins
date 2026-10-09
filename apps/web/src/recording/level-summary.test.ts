import { describe, expect, it } from 'vitest';

import { LevelSummary } from './level-summary.js';

const RATE = 48_000;

/** A report of one level on every channel. */
const meter = (peak: number, channels = 2) => ({
  peak: Array.from({ length: channels }, () => peak),
  rms: Array.from({ length: channels }, () => peak / 2),
  correlation: [],
});

describe('the input levels in words', () => {
  it('says the peak of a passage once the input has been quiet a while after it, and only then', () => {
    const levels = new LevelSummary();
    expect(levels.heard(meter(0.25), 0, RATE)).toBeUndefined();
    expect(levels.heard(meter(0.5), 1600, RATE)).toBeUndefined();
    expect(levels.heard(meter(0.001), 3200, RATE)).toBeUndefined();
    expect(levels.heard(meter(0.001), 3200 + RATE, RATE)).toBeUndefined();
    expect(levels.heard(meter(0.001), 3200 + 1.5 * RATE, RATE)).toBe(
      'The input peaked at −6.0 dB.',
    );
    // Said once: the quiet goes on, and nothing more is said of it.
    expect(levels.heard(meter(0.001), 3200 + 3 * RATE, RATE)).toBeUndefined();
  });

  it('says nothing of a quiet input, however long it stays quiet', () => {
    const levels = new LevelSummary();
    for (let second = 0; second < 10; second += 1) {
      expect(levels.heard(meter(0.001), second * RATE, RATE)).toBeUndefined();
    }
  });

  it('says a passage clipped where it reached full scale', () => {
    const levels = new LevelSummary();
    levels.heard(meter(1), 0, RATE);
    expect(levels.heard(meter(0), 2 * RATE, RATE)).toBeUndefined();
    expect(levels.heard(meter(0), 4 * RATE, RATE)).toBe('The input peaked at 0.0 dB, and clipped.');
  });

  it('says the levels now and the peak since last said on request, and starts again from them', () => {
    const levels = new LevelSummary();
    expect(levels.say()).toBe('No levels have arrived from the input yet.');
    levels.heard(meter(0.5), 0, RATE);
    levels.heard(meter(0.25), 1600, RATE);
    expect(levels.say()).toBe(
      'The input is at channel 1 −12.0 dB, channel 2 −12.0 dB; it peaked at −6.0 dB.',
    );
    expect(levels.say()).toBe(
      'The input is at channel 1 −12.0 dB, channel 2 −12.0 dB; it peaked at −∞ dB.',
    );
  });
});
