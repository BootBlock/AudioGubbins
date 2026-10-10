import { describe, expect, it } from 'vitest';

import { decodedOnce, holdsPercentEncoding } from './percent-decoding.js';

describe('decoding a layer of percent-encoding', () => {
  it('decodes each run as UTF-8, one layer at a time', () => {
    expect(decodedOnce('%2Fhome%2Fzo%C3%AB%2F%E5%BC%A0%F0%9F%8E%B5')).toBe('/home/zoë/张🎵');
    expect(decodedOnce('%252F')).toBe('%2F');
    expect(decodedOnce('100% of 50%ZZ')).toBe('100% of 50%ZZ');
  });

  it('reads a byte that begins no character, or a character cut short, as a replacement', () => {
    // Left encoded, `%FF` against a root would hide the root from the rule
    // that reads one: `%FF/home/jane` has a letter before its slash.
    expect(decodedOnce('%FF%2Fhome')).toBe('�/home');
    // An overlong slash, a surrogate and a code point past U+10FFFF are not
    // characters, and the bytes after a cut-short lead are read afresh.
    expect(decodedOnce('%C0%AF')).toBe('��');
    expect(decodedOnce('%ED%A0%80')).toBe('���');
    expect(decodedOnce('%F4%90%80%80')).toBe('����');
    expect(decodedOnce('%E5%BC%2F')).toBe('�/');
    expect(decodedOnce('%E5')).toBe('�');
  });

  it('says whether a text still holds a run to decode', () => {
    expect(holdsPercentEncoding('take%201')).toBe(true);
    expect(holdsPercentEncoding('100% of 50%ZZ')).toBe(false);
  });
});
