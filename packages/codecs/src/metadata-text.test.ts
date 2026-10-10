/**
 * The text codings metadata is read in, against the platform's own decoder
 * where it has one, and base64 against RFC 4648's vectors.
 */

import { describe, expect, it } from 'vitest';

import { decodeBase64, encodeBase64 } from './base64.js';
import {
  decodeLatin1,
  decodeUtf16,
  decodeUtf8,
  encodeLatin1,
  encodeUtf8,
} from './metadata-text.js';

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const asText = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('metadata text', () => {
  it('encodes UTF-8 as the platform does, a lone surrogate as U+FFFD', () => {
    for (const text of ['', 'plain', 'Ōcean — 海 𝄞', '\u0000\u007f\u0080߿ࠀ￿']) {
      expect(encodeUtf8(text)).toEqual(new TextEncoder().encode(text));
    }
    expect(encodeUtf8('a\ud800b')).toEqual(new TextEncoder().encode('a�b'));
  });

  it('decodes UTF-8, replacing each ill-formed sequence as the WHATWG decoder does', () => {
    const decoder = new TextDecoder();
    const cases = [
      Uint8Array.of(0x61, 0xc3, 0xa9),
      Uint8Array.of(0xf0, 0x9d, 0x84, 0x9e),
      Uint8Array.of(0x80, 0x61),
      Uint8Array.of(0xc0, 0xaf),
      Uint8Array.of(0xe0, 0x80, 0xaf),
      Uint8Array.of(0xed, 0xa0, 0x80),
      Uint8Array.of(0xf4, 0x90, 0x80, 0x80),
      Uint8Array.of(0xe2, 0x82),
      Uint8Array.of(0xf0, 0x9d, 0x84, 0x61),
      Uint8Array.of(0xff, 0xfe, 0x61),
    ];
    for (const bytes of cases) expect(decodeUtf8(bytes)).toBe(decoder.decode(bytes));
    const long = Uint8Array.from({ length: 20_000 }, (_, index) => 0x41 + (index % 26));
    expect(decodeUtf8(long)).toBe(decoder.decode(long));
  });

  it('decodes UTF-16 by its byte order mark or the default order', () => {
    expect(decodeUtf16(Uint8Array.of(0xff, 0xfe, 0x41, 0x00, 0x3d, 0xd8, 0x00, 0xde), true)).toBe(
      'A😀',
    );
    expect(decodeUtf16(Uint8Array.of(0xfe, 0xff, 0x00, 0x41), false)).toBe('A');
    expect(decodeUtf16(Uint8Array.of(0x00, 0x41, 0xd8, 0x00), true)).toBe('A�');
    expect(decodeUtf16(Uint8Array.of(0x41, 0x00, 0x42), false)).toBe('A�');
  });

  it('decodes and encodes Latin-1, refusing a character it has no byte for', () => {
    expect(decodeLatin1(Uint8Array.of(0x41, 0xe9, 0xff))).toBe('Aéÿ');
    expect(encodeLatin1('Aéÿ')).toEqual(Uint8Array.of(0x41, 0xe9, 0xff));
    expect(encodeLatin1('Ā')).toBeUndefined();
  });

  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes and decodes base64 of %j as RFC 4648 states', (plain, coded) => {
    expect(asText(encodeBase64(ascii(plain)))).toBe(coded);
    expect(decodeBase64(ascii(coded))).toEqual(ascii(plain));
  });

  it('refuses text that is not padded base64', () => {
    for (const text of ['Zg', 'Zg=', 'Z===', 'Zm9v!A==', 'Zm=v', 'Zm9vYmFy\n']) {
      expect(decodeBase64(ascii(text))).toBeUndefined();
    }
    const bytes = Uint8Array.from({ length: 1_000 }, (_, index) => (index * 151) & 0xff);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });
});
