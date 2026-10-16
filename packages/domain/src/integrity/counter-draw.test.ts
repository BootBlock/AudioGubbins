import { describe, expect, it } from 'vitest';

import { uniformDraw } from './counter-draw.js';

const TWO_TO_32 = 2 ** 32;
const MASK_32 = 0xffff_ffffn;

/**
 * `lowbias32` in arbitrary-precision arithmetic, every product reduced modulo
 * 2³² by hand, so it shares none of the 32-bit tricks (`Math.imul`, `>>>`) the
 * product code relies on.
 */
function referenceLowbias32(input: bigint): bigint {
  let x = input & MASK_32;
  x ^= x >> 16n;
  x = (x * 0x7feb_352dn) & MASK_32;
  x ^= x >> 15n;
  x = (x * 0x846c_a68bn) & MASK_32;
  x ^= x >> 16n;
  return x;
}

/** The draw as ADR-0092 states it, in exact arithmetic: the 32-bit word it divides by 2³². */
function referenceWord(key: number, stream: number, index: number): number {
  const mixed = (BigInt(stream + 1) * 0x9e37_79b9n) & MASK_32;
  const big = BigInt(index);
  let hash = referenceLowbias32((BigInt(key) & MASK_32) ^ mixed);
  hash = referenceLowbias32(hash ^ (big >> 32n));
  hash = referenceLowbias32(hash ^ (big & MASK_32));
  return Number(hash);
}

/** A seeded sequence of 32-bit words, the same every run. */
function patternWords(length: number, seed: number): number[] {
  let state = seed >>> 0;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  });
}

describe('uniformDraw', () => {
  // Taken from the dither's generator as Phase 09 shipped it: every dithered
  // export's bytes rest on these numbers, so any change here changes them.
  const PINS: readonly (readonly [key: number, stream: number, index: number, word: number])[] = [
    [0, 0, 0, 2_488_251_732],
    [0, 0, 1, 3_002_921_059],
    [0, 1, 0, 3_074_714_144],
    [1, 0, 0, 3_112_853_886],
    [0xffff_ffff, 0, 0, 750_385_467],
    [0xcbf4_3926, 0, 0, 142_998_525],
    [0xcbf4_3926, 1, 12_345, 639_577_345],
    [0xcbf4_3926, 7, 2 ** 32, 4_028_906_006],
    [0xcbf4_3926, 7, 2 ** 32 + 1, 2_912_198_407],
    [0xdead_beef, 3, Number.MAX_SAFE_INTEGER, 2_032_359_439],
  ];

  it('draws the numbers the dither has always drawn', () => {
    for (const [key, stream, index, word] of PINS) {
      expect(uniformDraw(key, stream, index)).toBe(word / TWO_TO_32);
    }
  });

  it('agrees with the draw computed in exact arithmetic over the edges and random inputs', () => {
    const keys = [0, 1, 0x7fff_ffff, 0x8000_0000, 0xffff_ffff, ...patternWords(2_000, 11)];
    const indices = [0, 1, TWO_TO_32 - 1, TWO_TO_32, Number.MAX_SAFE_INTEGER];
    for (const [position, key] of keys.entries()) {
      const stream = position % 20;
      const index = indices[position % indices.length] ?? 0;
      const spread = position * 1_000_003;
      for (const at of [index, spread]) {
        expect(uniformDraw(key, stream, at)).toBe(referenceWord(key, stream, at) / TWO_TO_32);
      }
    }
  });

  it('draws a multiple of 2⁻³² in [0, 1)', () => {
    for (const [index, key] of patternWords(5_000, 3).entries()) {
      const draw = uniformDraw(key, index % 6, index * 977);
      expect(draw >= 0 && draw < 1).toBe(true);
      expect(Number.isInteger(draw * TWO_TO_32)).toBe(true);
    }
  });

  it('separates draws by every input, including the high word of the index', () => {
    const base = uniformDraw(0x1234_5678, 2, 9);
    expect(uniformDraw(0x1234_5679, 2, 9)).not.toBe(base);
    expect(uniformDraw(0x1234_5678, 3, 9)).not.toBe(base);
    expect(uniformDraw(0x1234_5678, 2, 10)).not.toBe(base);
    expect(uniformDraw(0x1234_5678, 2, 9 + TWO_TO_32)).not.toBe(base);
  });

  it('fills sixteen equal bins evenly over a stream', () => {
    const draws = 65_536;
    const bins = new Array<number>(16).fill(0);
    for (let index = 0; index < draws; index += 1) {
      const bin = Math.floor(uniformDraw(0xcbf4_3926, 0, index) * 16);
      bins[bin] = (bins[bin] ?? 0) + 1;
    }
    const expected = draws / 16;
    const chiSquare = bins.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    // 15 degrees of freedom: 37.7 is the 0.1% point, so a uniform stream stays below it.
    expect(chiSquare).toBeLessThan(37.7);
  });
});
