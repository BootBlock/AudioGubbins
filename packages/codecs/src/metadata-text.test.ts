/**
 * The text rule every metadata reader shares: each coding against the
 * platform's own decoder where it has one, what keeping removes and bounds, and
 * base64 against RFC 4648's vectors.
 */

import { describe, expect, it } from 'vitest';

import { decodeBase64, encodeBase64 } from './base64.js';
import {
  DOCUMENT_TEXT,
  LINE_TEXT,
  LONG_TEXT,
  decodeText,
  encodeLatin1,
  encodeUtf8,
  keptText,
  readText,
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
    for (const bytes of cases) expect(decodeText(bytes, 'utf-8')).toBe(decoder.decode(bytes));
    const long = Uint8Array.from({ length: 20_000 }, (_, index) => 0x41 + (index % 26));
    expect(decodeText(long, 'utf-8')).toBe(decoder.decode(long));
  });

  it('decodes UTF-16 by its byte order mark or the default order', () => {
    expect(
      decodeText(Uint8Array.of(0xff, 0xfe, 0x41, 0x00, 0x3d, 0xd8, 0x00, 0xde), 'utf-16be'),
    ).toBe('A😀');
    expect(decodeText(Uint8Array.of(0xfe, 0xff, 0x00, 0x41), 'utf-16')).toBe('A');
    expect(decodeText(Uint8Array.of(0x00, 0x41, 0xd8, 0x00), 'utf-16be')).toBe('A�');
    expect(decodeText(Uint8Array.of(0x41, 0x00, 0x42), 'utf-16')).toBe('A�');
  });

  it('decodes and encodes Latin-1, refusing a character it has no byte for', () => {
    expect(decodeText(Uint8Array.of(0x41, 0xe9, 0xff), 'latin-1')).toBe('Aéÿ');
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

describe('the text rule', () => {
  it('ends a value at its first NUL in every coding', () => {
    expect(decodeText(Uint8Array.of(0x41, 0x00, 0x42), 'utf-8')).toBe('A');
    expect(decodeText(Uint8Array.of(0x41, 0x00, 0xff), 'unstated')).toBe('A');
    expect(decodeText(Uint8Array.of(0x41, 0x00, 0x42), 'latin-1')).toBe('A');
    expect(decodeText(Uint8Array.of(0x00, 0x41, 0x00, 0x00, 0x00, 0x42), 'utf-16be')).toBe('A');
    expect(
      decodeText(Uint8Array.of(0xff, 0xfe, 0x41, 0x00, 0x00, 0x00, 0x42, 0x00), 'utf-16'),
    ).toBe('A');
  });

  it('removes control characters from every coding, keeping line breaks in long text', () => {
    const controlled = '\u001b[31mRed\u007f\u0085\tTab\r\nLine';
    expect(keptText(controlled, LINE_TEXT)).toBe('[31mRedTabLine');
    expect(keptText(controlled, LONG_TEXT)).toBe('[31mRed\tTab\r\nLine');
    expect(readText(encodeUtf8(controlled), 'utf-8', LINE_TEXT)).toBe('[31mRedTabLine');
  });

  it('decodes UTF-8 only where every byte is valid, else every byte as Latin-1', () => {
    expect(readText(encodeUtf8('Zoë 🌧'), 'unstated', LINE_TEXT)).toBe('Zoë 🌧');
    // An overlong slash, an encoded surrogate and a truncated sequence are not UTF-8.
    expect(readText(Uint8Array.of(0x41, 0xc0, 0xaf), 'unstated', LINE_TEXT)).toBe('AÀ¯');
    // As Latin-1, 0xA0 is a no-break space, kept, and 0x80 a C1 control, removed.
    expect(readText(Uint8Array.of(0xed, 0xa0, 0x80), 'unstated', LINE_TEXT)).toBe('í ');
    expect(readText(Uint8Array.of(0x41, 0xe2, 0x82), 'unstated', LINE_TEXT)).toBe('Aâ');
  });

  it('bounds text in characters, never splitting one', () => {
    const long = '🌧'.repeat(LINE_TEXT.maximumCharacters + 10);
    expect(readText(encodeUtf8(long), 'unstated', LINE_TEXT)).toBe(
      '🌧'.repeat(LINE_TEXT.maximumCharacters),
    );
    expect(readText(encodeUtf8('a'.repeat(300_000)), 'unstated', DOCUMENT_TEXT)).toHaveLength(
      262_144,
    );
    expect(readText(encodeUtf8('a\nb'), 'unstated', LONG_TEXT)).toBe('a\nb');
  });
});
