import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { adtsAudioConfig } from './adts-config.js';
import { readAacConfig } from './aac-config.js';
import { memoryBytes } from './testing/index.js';

/** An ADTS frame header of AAC-LC (profile 1), without a checksum, and a body. */
function adtsFrame(rateIndex: number, channels: number): Uint8Array {
  const length = 7 + 20;
  return Uint8Array.from([
    0xff,
    0xf1,
    (1 << 6) | (rateIndex << 2) | (channels >> 2),
    ((channels & 3) << 6) | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc,
    ...new Array<number>(20).fill(0),
  ]);
}

/** An ID3v2.4 tag of `size` bytes of padding. */
function id3Tag(size: number): Uint8Array {
  return Uint8Array.from([
    0x49,
    0x44,
    0x33,
    4,
    0,
    0,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
    ...new Array<number>(size).fill(0),
  ]);
}

describe('the configuration of an ADTS stream', () => {
  it('states the object type, rate and channels of its first frame, after any ID3 tag', async () => {
    const config = expectSuccess(await adtsAudioConfig(memoryBytes(adtsFrame(4, 2))));
    expect([...config]).toEqual([0x12, 0x10]);
    expect(expectSuccess(readAacConfig(config))).toMatchObject({
      objectType: 2,
      sampleRate: 44_100,
      channels: 2,
    });
    const tagged = new Uint8Array([...id3Tag(300), ...adtsFrame(6, 1)]);
    expect(
      expectSuccess(readAacConfig(expectSuccess(await adtsAudioConfig(memoryBytes(tagged))))),
    ).toMatchObject({
      sampleRate: 24_000,
      channels: 1,
    });
  });

  it('refuses a file that does not begin with a frame, and headers of no rate or channels', async () => {
    const refusal = async (bytes: Uint8Array) =>
      expectFailureCode(await adtsAudioConfig(memoryBytes(bytes)));
    expect(await refusal(Uint8Array.of(0xff, 0xfb, 0x90, 0x00, 0, 0, 0))).toBe('codecs.malformed');
    expect(await refusal(adtsFrame(13, 2))).toBe('codecs.malformed');
    expect(await refusal(adtsFrame(4, 0))).toBe('codecs.malformed');
    expect(await refusal(Uint8Array.of(0xff, 0xf1))).toBe('codecs.malformed');
  });
});
