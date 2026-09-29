import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  DIGEST_HEX,
  contentIdFrom,
  hexOf,
  isContentId,
  isStateFingerprint,
  stateFingerprintFrom,
} from './content-identity.js';

const DIGITS = '0123456789abcdef'.repeat(4);

describe('content identifiers', () => {
  it('accepts c1- and 64 lower-case hexadecimal digits', () => {
    expect(isContentId(`c1-${DIGITS}`)).toBe(true);
    expect(expectSuccess(contentIdFrom(`c1-${DIGITS}`))).toBe(`c1-${DIGITS}`);
  });

  it.each([
    ['upper-case digits', `c1-${DIGITS.toUpperCase()}`],
    ['another construction', `c2-${DIGITS}`],
    ['a fingerprint', `s1-${DIGITS}`],
    ['a digit short', `c1-${DIGITS.slice(1)}`],
    ['a digit over', `c1-${DIGITS}0`],
    ['no prefix', DIGITS],
    ['a trailing newline', `c1-${DIGITS}\n`],
  ])('refuses %s', (_case, text) => {
    expect(isContentId(text)).toBe(false);
    expect(expectFailureCode(contentIdFrom(text))).toBe('content-id.malformed');
  });

  it('says how long the refused text was, and never quotes it', () => {
    const result = contentIdFrom('C:\\Users\\someone\\secret.wav');
    expect(result.ok ? undefined : result.failures[0].details).toEqual({ length: 27 });
  });
});

describe('state fingerprints', () => {
  it('accepts s1- and 64 lower-case hexadecimal digits, and nothing else', () => {
    expect(isStateFingerprint(`s1-${DIGITS}`)).toBe(true);
    expect(expectSuccess(stateFingerprintFrom(`s1-${DIGITS}`))).toBe(`s1-${DIGITS}`);
    expect(isStateFingerprint(`c1-${DIGITS}`)).toBe(false);
    expect(expectFailureCode(stateFingerprintFrom(`s1-${DIGITS.slice(2)}`))).toBe(
      'state-fingerprint.malformed',
    );
  });
});

describe('hexOf', () => {
  it('writes each byte as two lower-case digits', () => {
    expect(hexOf(new Uint8Array([0, 1, 0x0f, 0x10, 0xab, 0xff]))).toBe('00010f10abff');
    expect(hexOf(new Uint8Array())).toBe('');
  });

  it('writes a digest in the shape DIGEST_HEX accepts', () => {
    expect(DIGEST_HEX.test(hexOf(new Uint8Array(32).fill(0xc4)))).toBe(true);
    expect(DIGEST_HEX.test(hexOf(new Uint8Array(31)))).toBe(false);
  });
});
