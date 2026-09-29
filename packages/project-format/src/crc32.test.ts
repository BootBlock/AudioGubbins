import { crc32 as zlibCrc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { crc32 } from './crc32.js';
import { encodeUtf8 } from './utf8.js';
import { patternBytes } from './testing/zip-archives.js';

describe('crc32', () => {
  it('gives the check value of the ZIP polynomial for "123456789"', () => {
    expect(crc32(encodeUtf8('123456789'))).toBe(0xcbf43926);
  });

  it('gives the known values of nothing, one byte and a sentence', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(encodeUtf8('a'))).toBe(0xe8b7be43);
    expect(crc32(encodeUtf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('agrees with zlib over every byte value and random bytes', () => {
    const everyByte = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(crc32(everyByte)).toBe(zlibCrc32(everyByte));
    const random = patternBytes(100_003, 7);
    expect(crc32(random)).toBe(zlibCrc32(random));
  });

  it('continues across chunks to the CRC of the whole, however the bytes are split', () => {
    const bytes = patternBytes(10_000, 3);
    for (const split of [0, 1, 4_095, 9_999, 10_000]) {
      const first = crc32(bytes.subarray(0, split));
      expect(crc32(bytes.subarray(split), first)).toBe(crc32(bytes));
    }
  });
});
