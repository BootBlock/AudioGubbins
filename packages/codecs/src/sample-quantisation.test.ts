import { describe, expect, it } from 'vitest';

import { quantiseSample } from './sample-quantisation.js';

describe('quantiseSample', () => {
  it('gives back every integer of a depth from the value it reads as', () => {
    for (const bits of [8, 16, 24, 32]) {
      const scale = 2 ** (bits - 1);
      for (const integer of [-scale, -scale + 1, -1, 0, 1, scale - 2, scale - 1]) {
        expect(quantiseSample(integer / scale, bits)).toBe(integer);
      }
    }
  });

  it('sends a tie to the even integer on either side of zero', () => {
    const half = 0.5 / 2 ** 15;
    expect(quantiseSample(2 * half * 2 + half, 16)).toBe(2);
    expect(quantiseSample(2 * half * 3 + half, 16)).toBe(4);
    expect(quantiseSample(-(2 * half * 2 + half), 16)).toBe(-2);
    expect(quantiseSample(-(2 * half * 3 + half), 16)).toBe(-4);
  });

  it('clamps to the depth and quantises not-a-number to zero', () => {
    expect(quantiseSample(1, 16)).toBe(32_767);
    expect(quantiseSample(-1.5, 16)).toBe(-32_768);
    expect(quantiseSample(Number.POSITIVE_INFINITY, 24)).toBe(8_388_607);
    expect(quantiseSample(Number.NaN, 24)).toBe(0);
  });
});
