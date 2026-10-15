import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { analysisWindow, seamReference } from './loop-windows.js';

const rate = (hertz: number) => expectSuccess(sampleRate(hertz));

describe('the analysis window', () => {
  it('is 50 ms, at most a quarter of the loop', () => {
    expect(analysisWindow(rate(48_000), 48_000)).toBe(2_400);
    expect(analysisWindow(rate(44_100), 48_000)).toBe(2_205);
    expect(analysisWindow(rate(48_000), 4_000)).toBe(1_000);
  });

  it('is at most 32,768 frames, the 50 ms shortened above 655 kHz', () => {
    expect(analysisWindow(rate(8_000), 100_000)).toBe(400);
    expect(analysisWindow(rate(655_360), 1_000_000)).toBe(32_768);
    expect(analysisWindow(rate(768_000), 1_000_000)).toBe(32_768);
  });

  it('keeps its 50 ms for a loop under 256 frames, which is read around itself', () => {
    expect(analysisWindow(rate(48_000), 255)).toBe(2_400);
    expect(analysisWindow(rate(48_000), 256)).toBe(64);
  });
});

describe('the reference a seam is compared with', () => {
  it('is the audio after E, then the audio before S, then the loop itself', () => {
    const window = 100;
    expect(seamReference({ start: 500, end: 2_000, regionLength: 2_100, window })).toBe('post-end');
    expect(seamReference({ start: 500, end: 2_000, regionLength: 2_099, window })).toBe(
      'pre-start',
    );
    expect(seamReference({ start: 99, end: 2_000, regionLength: 2_099, window })).toBe('adjacent');
  });

  it('is only the loop itself for a loop read around itself', () => {
    expect(seamReference({ start: 5_000, end: 5_100, regionLength: 20_000, window: 2_400 })).toBe(
      'adjacent',
    );
  });
});
