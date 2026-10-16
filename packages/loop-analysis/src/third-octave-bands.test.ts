import { describe, expect, it } from 'vitest';

import { thirdOctaveBands } from './third-octave-bands.js';

describe('the third-octave bands', () => {
  it.each([
    [48_000, 2_048],
    [44_100, 2_048],
    [96_000, 4_096],
    [48_000, 64],
  ])(
    'cover the bins from the first above 0 Hz without gap or overlap at %i Hz, size %i',
    (rate, size) => {
      const bands = thirdOctaveBands(rate, size);
      expect(bands[0]?.from).toBe(1);
      bands.slice(1).forEach((band, index) => {
        expect(band.from).toBe(bands[index]?.to);
      });
      for (const band of bands) expect(band.to).toBeGreaterThan(band.from);
      // Every band after the merged lowest holds four bins at least.
      for (const band of bands.slice(1)) expect(band.to - band.from).toBeGreaterThanOrEqual(4);
      const highest = Math.min(20_000, 0.45 * rate);
      expect(((bands[bands.length - 1]?.to ?? 0) - 1) * (rate / size)).toBeLessThan(highest);
    },
  );

  it('merges every bin below the first band of four into one band', () => {
    // At 48 kHz and 2,048 a bin is 23.4 Hz; the 315 Hz band, 281 to 354 Hz,
    // is the first to hold four bins, 12 to 15.
    const bands = thirdOctaveBands(48_000, 2_048);
    expect(bands.slice(0, 2)).toEqual([
      { from: 1, to: 12 },
      { from: 12, to: 16 },
    ]);
  });
});
