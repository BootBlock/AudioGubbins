import { describe, expect, it } from 'vitest';

import { gainToDecibels } from '@audiogubbins/audio-engine';

import {
  ENVELOPE_BINS,
  binOf,
  binValue,
  histogramSpread,
  stepDecibels,
} from './envelope-histogram.js';

function histogramOf(values: readonly number[]): Uint32Array {
  const histogram = new Uint32Array(ENVELOPE_BINS);
  for (const value of values) histogram[binOf(value)] = (histogram[binOf(value)] ?? 0) + 1;
  return histogram;
}

describe('the envelope histogram', () => {
  it('reads a step as its RMS in dB, floored at −120 dBFS', () => {
    expect(stepDecibels(0.25 * 480, 480)).toBe(gainToDecibels(0.5));
    expect(stepDecibels(0, 480)).toBe(-120);
    expect(stepDecibels(1e-14 * 480, 480)).toBe(-120);
  });

  it('counts values in 0.1 dB bins, the loudest and quietest in the end bins', () => {
    expect(binValue(binOf(-20.04))).toBeCloseTo(-20.05, 10);
    expect(binOf(-130)).toBe(0);
    expect(binOf(40)).toBe(ENVELOPE_BINS - 1);
  });

  it('reads the median and median absolute deviation to the resolution of a bin', () => {
    const spread = histogramSpread(histogramOf([-20.01, -19.01, -21.01, -18.01, -22.01]), 5);
    expect(spread.median).toBeCloseTo(-20.05, 10);
    expect(spread.deviation).toBeCloseTo(1, 10);
  });

  it('has no deviation for a steady envelope, and takes the lower middle of an even count', () => {
    expect(histogramSpread(histogramOf([-6, -6, -6, -6]), 4).deviation).toBe(0);
    expect(histogramSpread(histogramOf([-30, -10]), 2).median).toBeCloseTo(-29.95, 10);
  });
});
