/**
 * MD5 against the test suite of RFC 1321, appendix A.5, and against itself
 * fed the same message in pieces of every size, since FLAC's samples arrive a
 * block at a time.
 */

import { describe, expect, it } from 'vitest';

import { Md5 } from './md5.js';

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const digestOf = (text: string) => {
  const md5 = new Md5();
  md5.update(ascii(text));
  return hex(md5.digest());
};

describe('MD5', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'd174ab98d277d9f5a5611c2c9f419d9f',
    ],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ])('digests %j as RFC 1321 states', (message, expected) => {
    expect(digestOf(message)).toBe(expected);
  });

  it('digests a message fed in pieces as it digests it whole', () => {
    const message = Uint8Array.from({ length: 1_000 }, (_, index) => (index * 37 + 11) & 0xff);
    const whole = new Md5();
    whole.update(message);
    const expected = hex(whole.digest());
    for (const piece of [1, 3, 55, 56, 63, 64, 65, 127, 999]) {
      const md5 = new Md5();
      for (let offset = 0; offset < message.length; offset += piece) {
        md5.update(message.subarray(offset, offset + piece));
      }
      expect(hex(md5.digest()), `pieces of ${String(piece)}`).toBe(expected);
    }
  });
});
