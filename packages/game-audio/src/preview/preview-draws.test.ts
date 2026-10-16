/**
 * The preview's draws (ADR-0104), each formula against an independent
 * statement of it: the key against the hash and the CRC written out, a whole
 * choice against BigInt arithmetic, a pitch's ratio against exact integer
 * bounds.
 */

import { describe, expect, it } from 'vitest';

import { crc32, lowbias32, uniformDraw, unsafeBrandId } from '@audiogubbins/domain';

import { emitterId } from '../testing/preview-vectors.js';
import {
  DrawStream,
  choiceOf,
  drawWord,
  emitterKey,
  framesOf,
  pitchNumerator,
} from './preview-draws.js';

describe("an emitter's key", () => {
  it('is lowbias32 of the seed mixed with the CRC-32 of the identifier’s bytes', () => {
    const id = unsafeBrandId<'PreviewEmitterId'>('0123abcd-ef45');
    const bytes = Uint8Array.from({ length: id.length }, (_, index) => id.charCodeAt(index));
    expect(emitterKey(0xdead_beef, id)).toBe(lowbias32((0xdead_beef ^ crc32(bytes)) >>> 0));
  });

  it('depends on the emitter alone, never on where the emitter is in its scenario', () => {
    // The key is all a draw knows of its emitter, so it is the same for an
    // emitter at any place; and two emitters of one seed draw apart.
    expect(emitterKey(7, emitterId(1))).toBe(emitterKey(7, emitterId(1)));
    expect(emitterKey(7, emitterId(1))).not.toBe(emitterKey(7, emitterId(2)));
    expect(emitterKey(7, emitterId(1))).not.toBe(emitterKey(8, emitterId(1)));
  });

  it('is pinned for the vectors, as Python’s zlib.crc32 and lowbias32 written out compute them', () => {
    expect(emitterKey(0, emitterId(1))).toBe(1_906_883_172);
    expect(emitterKey(42, emitterId(2))).toBe(1_273_944_031);
  });
});

describe('a draw', () => {
  it('is the word the domain’s uniform draw is a fraction of', () => {
    for (const stream of Object.values(DrawStream)) {
      expect(drawWord(99, stream, 3)).toBe(uniformDraw(99, stream, 3) * 2 ** 32);
      expect(Number.isInteger(drawWord(99, stream, 3))).toBe(true);
    }
  });

  it('chooses ⌊h·n / 2³²⌋ exactly, where the double product ⌊u·n⌋ may not', () => {
    const words = [0, 1, 0xffff_ffff, 0xffff_fffe, 0x8000_0000, 0x1234_5678, 0xdead_beef];
    const counts = [1, 2, 3, 7, 4_801, 480_001, 7_680_001, 2 ** 23 + 1];
    for (const word of words) {
      for (const n of counts) {
        const exact = Number((BigInt(word) * BigInt(n)) >> 32n);
        expect(choiceOf(word, n), `${String(word)}·${String(n)}`).toBe(exact);
      }
    }
    // Words just below a boundary, where the product of doubles rounds up past it.
    expect(choiceOf(2_517_850_057, 6_000_007)).toBe(3_517_399);
    expect(Math.floor((2_517_850_057 / 2 ** 32) * 6_000_007)).toBe(3_517_400);
    expect(choiceOf(3_816_563_714, 7_999_999)).toBe(7_108_902);
  });

  it('is uniform over every choice to within 2⁻³² of a word', () => {
    // Each of n choices is made by ⌊2³²/n⌋ or ⌈2³²/n⌉ words: the first word of
    // choice c is ⌈c·2³²/n⌉.
    const n = 3;
    for (let choice = 0; choice < n; choice += 1) {
      const first = Number(((BigInt(choice) << 32n) + BigInt(n) - 1n) / BigInt(n));
      expect(choiceOf(first, n)).toBe(choice);
      if (first > 0) expect(choiceOf(first - 1, n)).toBe(choice - 1);
    }
  });
});

describe('a time in frames', () => {
  it('is rounded half up from milliseconds at the rate', () => {
    expect(framesOf(5, 48_000)).toBe(240);
    expect(framesOf(1, 44_100)).toBe(44); // 44.1
    expect(framesOf(10, 44_100)).toBe(441);
    expect(framesOf(0.5, 1_000)).toBe(1); // exactly a half
    expect(framesOf(30, 44_100)).toBe(1_323);
  });
});

describe("a pitch's ratio", () => {
  /** Whether `n` is the whole number nearest 4096·2^(c/1200), by exact integer powers. */
  function nearest(n: number, cents: number): boolean {
    // (2n − 1)/8192 < 2^(c/1200) < (2n + 1)/8192, each side raised to the 1200th.
    const unit = 8_192n ** 1_200n;
    const scaled = (value: bigint): bigint => (cents >= 0 ? value : value << BigInt(-cents));
    const target = cents >= 0 ? unit << BigInt(cents) : unit;
    return (
      scaled(BigInt(2 * n - 1) ** 1_200n) < target && target < scaled(BigInt(2 * n + 1) ** 1_200n)
    );
  }

  it('is the nearest whole 4,096th, exactly, across the range', () => {
    const cents = [-2_400, -1_200, -1, 0, 1, 7, 100, 1_199, 1_200, 2_399, 2_400];
    for (let one = -2_400; one <= 2_400; one += 97) cents.push(one);
    for (const one of cents) expect(nearest(pitchNumerator(one), one), String(one)).toBe(true);
  });

  it('spans two octaves either way and is unison at no cents', () => {
    expect(pitchNumerator(-2_400)).toBe(1_024);
    expect(pitchNumerator(0)).toBe(4_096);
    expect(pitchNumerator(2_400)).toBe(16_384);
    expect(pitchNumerator(1)).toBe(4_098);
    expect(pitchNumerator(-1)).toBe(4_094);
  });
});
