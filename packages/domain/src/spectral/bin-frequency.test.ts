import { describe, expect, it } from 'vitest';

import { binFrequency, nearestBin } from './bin-frequency.js';

describe('the frequency of a bin', () => {
  it('centres bin k at k · rate / N', () => {
    expect(binFrequency(0, 48_000, 2_048)).toBe(0);
    expect(binFrequency(1, 48_000, 2_048)).toBe(23.4375);
    expect(binFrequency(1_024, 44_100, 2_048)).toBe(22_050);
  });

  it.each([
    [44_100, 256],
    [44_100, 16_384],
    [48_000, 2_048],
    [96_000, 4_096],
  ])('at %i Hz over %i samples, finds each bin from its centre', (rate, size) => {
    for (let bin = 0; bin <= size / 2; bin += 1) {
      expect(nearestBin(binFrequency(bin, rate, size), rate, size)).toBe(bin);
    }
  });

  it('takes the higher bin halfway between two centres, and the nearer one elsewhere', () => {
    const spacing = binFrequency(1, 48_000, 2_048);
    expect(nearestBin(10.5 * spacing, 48_000, 2_048)).toBe(11);
    expect(nearestBin(10.49 * spacing, 48_000, 2_048)).toBe(10);
  });
});
