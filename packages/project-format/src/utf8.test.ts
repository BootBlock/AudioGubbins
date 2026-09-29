import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { seededRandom } from './testing/random-values.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

/** Node's own encoder, as an independent reference. */
function referenceBytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

/** A random well-formed string drawn from every width of UTF-8. */
function randomText(seed: number): string {
  const random = seededRandom(seed);
  const points = [
    0x00, 0x24, 0x7f, 0x80, 0xa3, 0x7ff, 0x800, 0x20ac, 0xd7ff, 0xe000, 0xfeff, 0xffff, 0x10000,
    0x1f3b5, 0x10ffff,
  ];
  let text = '';
  for (let index = random.below(40); index > 0; index -= 1) {
    const point = random.chance(0.5) ? random.pick(points) : random.below(0xd800);
    text += String.fromCodePoint(point);
  }
  return text;
}

describe('encodeUtf8', () => {
  it('writes the bytes Node writes, for text of every width', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const text = randomText(seed);
      expect(encodeUtf8(text)).toEqual(referenceBytes(text));
    }
  });

  it('writes nothing for empty text', () => {
    expect(encodeUtf8('')).toEqual(new Uint8Array());
  });

  it('throws on a lone surrogate, which has no UTF-8 form', () => {
    expect(() => encodeUtf8('a\ud800b')).toThrow(RangeError);
    expect(() => encodeUtf8('\udc00')).toThrow(RangeError);
    expect(() => encodeUtf8('end\ud83c')).toThrow(RangeError);
  });
});

describe('decodeUtf8', () => {
  it('reads back what was encoded, for text of every width', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const text = randomText(seed);
      expect(expectSuccess(decodeUtf8(referenceBytes(text)))).toBe(text);
    }
  });

  it('reads text longer than one flush of code units whole', () => {
    const text = 'ab🎵é'.repeat(5_000);
    expect(expectSuccess(decodeUtf8(encodeUtf8(text)))).toBe(text);
  });

  it('keeps a byte order mark as the character it is', () => {
    expect(expectSuccess(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])))).toBe('﻿A');
  });

  it.each([
    [
      'a continuation byte where a character begins',
      [0x41, 0x80],
      'utf8.unexpected-continuation-byte',
      1,
    ],
    ['an overlong two-byte form', [0xc0, 0xaf], 'utf8.overlong-encoding', 0],
    ['an overlong three-byte form', [0xe0, 0x80, 0xaf], 'utf8.overlong-encoding', 0],
    ['an overlong four-byte form', [0xf0, 0x80, 0x80, 0xaf], 'utf8.overlong-encoding', 0],
    ['an encoded surrogate', [0xed, 0xa0, 0x80], 'utf8.surrogate-code-point', 0],
    ['a point past U+10FFFF', [0xf4, 0x90, 0x80, 0x80], 'utf8.beyond-unicode', 0],
    ['a lead byte no character uses', [0xff], 'utf8.beyond-unicode', 0],
    ['an interrupted second byte', [0xc3, 0x41], 'utf8.invalid-continuation-byte', 0],
    ['an interrupted third byte', [0xe2, 0x82, 0x41], 'utf8.invalid-continuation-byte', 0],
    ['a truncated sequence', [0x41, 0xe2, 0x82], 'utf8.truncated-sequence', 1],
  ])('refuses %s', (_case, bytes, code, offset) => {
    const result = decodeUtf8(new Uint8Array(bytes));
    expect(expectFailureCode(result)).toBe(code);
    expect(result.ok ? undefined : result.failures[0].details).toEqual({ offset });
  });

  it('agrees with the platform decoder on which of every two-byte sequence are well formed', () => {
    const strict = new TextDecoder('utf-8', { fatal: true });
    for (let first = 0; first < 256; first += 1) {
      for (let second = 0; second < 256; second += 1) {
        const bytes = new Uint8Array([first, second]);
        let platform = true;
        try {
          strict.decode(bytes);
        } catch (error: unknown) {
          // The fatal decoder's refusal is the answer being compared.
          if (!(error instanceof TypeError)) throw error;
          platform = false;
        }
        expect(decodeUtf8(bytes).ok, `${first.toString(16)} ${second.toString(16)}`).toBe(platform);
      }
    }
  });

  it('agrees with the platform decoder on random sequences of three and four bytes', () => {
    const strict = new TextDecoder('utf-8', { fatal: true });
    const random = seededRandom(7);
    const leads = [0xe0, 0xe1, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5];
    const others = [0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0];
    for (let trial = 0; trial < 20_000; trial += 1) {
      const length = random.chance(0.5) ? 3 : 4;
      const bytes = new Uint8Array([
        random.pick(leads),
        ...Array.from({ length: length - 1 }, () => random.pick(others)),
      ]);
      let platform = true;
      try {
        strict.decode(bytes);
      } catch (error: unknown) {
        // The fatal decoder's refusal is the answer being compared.
        if (!(error instanceof TypeError)) throw error;
        platform = false;
      }
      expect(decodeUtf8(bytes).ok, [...bytes].map((byte) => byte.toString(16)).join(' ')).toBe(
        platform,
      );
    }
  });
});
