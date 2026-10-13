/**
 * Lossy exports, round trip and reproducibility (ADR-0091): MP3 by LAME, Ogg
 * Vorbis by libvorbis and Opus by the codec module, each decoded by the codec
 * module, which gives back exactly as many frames as were exported, the
 * encoder's priming and padding trimmed by what the file states, and within a
 * stated error of the source. Every bit-rate mode of each encoder is here, and
 * Vorbis in three, six and eight channels, each channel its own tones, so a
 * channel written in the wrong place fails the error.
 *
 * The error is the signal-to-noise ratio of the decoded audio against the
 * source, sample for sample over every channel, with no alignment searched
 * for: a file whose trimming were a frame out would fall far below it. The
 * test signal is three partials a channel under a slow swell, with a little
 * noise. Each floor lies about six decibels under what the encoder gives
 * today, so a change of encoder that loses quality fails here. These decodes
 * of real encoders' output are the codec module's MP3 and Vorbis fixtures
 * too.
 */

import { createHash } from 'node:crypto';

import { writtenChannelOrder } from '@audiogubbins/codecs';
import { ChannelRole, StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { exportTarget, type FormatEncoding } from '@audiogubbins/import-export';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import {
  decodeAll,
  encodeWhole,
  exportRequest,
  snrDb,
  testSignal,
} from '../testing/export-encoding.js';
import { memoryBytes } from '../testing/memory-bytes.js';

/** Each case encodes and decodes seconds of audio, several times over, in WebAssembly. */
const ENCODING_TIMEOUT_MS = 60_000;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** One lossy export: what is encoded, at what rate and layout, and the SNR it must keep. */
interface LossyCase {
  readonly name: string;
  readonly encoding: FormatEncoding;
  readonly rate: number;
  readonly layout: ChannelLayout;
  readonly floorDb: number;
}

const CASES: readonly LossyCase[] = [
  {
    name: 'MP3 at a constant 320 kbit/s',
    encoding: { format: 'mp3', encoding: { mode: 'constant', bitRate: 320 } },
    rate: 44_100,
    layout: StandardLayouts.stereo,
    floorDb: 40,
  },
  {
    name: 'MP3 at a constant 128 kbit/s',
    encoding: { format: 'mp3', encoding: { mode: 'constant', bitRate: 128 } },
    rate: 44_100,
    layout: StandardLayouts.stereo,
    floorDb: 19,
  },
  {
    name: 'MP3 at a constant 56 kbit/s in mono',
    encoding: { format: 'mp3', encoding: { mode: 'constant', bitRate: 56 } },
    rate: 48_000,
    layout: StandardLayouts.mono,
    floorDb: 15,
  },
  {
    name: 'MP3 at an average 160 kbit/s',
    encoding: { format: 'mp3', encoding: { mode: 'average', bitRate: 160 } },
    rate: 44_100,
    layout: StandardLayouts.stereo,
    floorDb: 19,
  },
  {
    name: 'MP3 at an average 48 kbit/s at 11.025 kHz, MPEG-2.5',
    encoding: { format: 'mp3', encoding: { mode: 'average', bitRate: 48 } },
    rate: 11_025,
    layout: StandardLayouts.stereo,
    floorDb: 19,
  },
  {
    name: 'MP3 of variable bit rate at V0',
    encoding: { format: 'mp3', encoding: { mode: 'variable', quality: 0 } },
    rate: 48_000,
    layout: StandardLayouts.stereo,
    floorDb: 35,
  },
  {
    name: 'Ogg Vorbis at quality 10',
    encoding: { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 10 } },
    rate: 48_000,
    layout: StandardLayouts.stereo,
    floorDb: 31,
  },
  {
    name: 'Ogg Vorbis at quality 3',
    encoding: { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 3 } },
    rate: 44_100,
    layout: StandardLayouts.mono,
    floorDb: 28,
  },
  {
    name: 'Ogg Vorbis at a nominal 128 kbit/s',
    encoding: { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 128 } },
    rate: 44_100,
    layout: StandardLayouts.stereo,
    floorDb: 30,
  },
  {
    name: 'Ogg Vorbis in three channels, LCR, at quality 6',
    encoding: { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 6 } },
    rate: 48_000,
    layout: StandardLayouts.lcr,
    floorDb: 31,
  },
  {
    name: 'Ogg Vorbis in 5.1 at a nominal 384 kbit/s, libvorbis’s 5.1 setup',
    encoding: { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 384 } },
    rate: 48_000,
    layout: StandardLayouts.surround5_1,
    // libvorbis codes the low-frequency channel coarsely, which bounds the whole.
    floorDb: 14,
  },
  {
    name: 'Ogg Vorbis in 7.1 at quality 5',
    encoding: { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 5 } },
    rate: 48_000,
    layout: StandardLayouts.surround7_1,
    floorDb: 30,
  },
  {
    name: 'Opus at 256 kbit/s',
    encoding: {
      format: 'opus',
      encoding: { bitRate: 256, application: 'audio', frameDuration: 20, complexity: 10 },
    },
    rate: 48_000,
    layout: StandardLayouts.stereo,
    floorDb: 29,
  },
  {
    name: 'Opus at 96 kbit/s',
    encoding: {
      format: 'opus',
      encoding: { bitRate: 96, application: 'audio', frameDuration: 20, complexity: 10 },
    },
    rate: 48_000,
    layout: StandardLayouts.stereo,
    floorDb: 25,
  },
  {
    name: 'Opus in 5.1 at 384 kbit/s, mapping family 1',
    encoding: {
      format: 'opus',
      encoding: { bitRate: 384, application: 'audio', frameDuration: 20, complexity: 10 },
    },
    rate: 48_000,
    layout: StandardLayouts.surround5_1,
    floorDb: 20,
  },
];

describe('lossy exports, decoded by the codec module', () => {
  it.each(CASES)(
    '$name keeps every frame and the stated error',
    async (one) => {
      const module = await codecModule();
      const frames = one.rate * 2 + 123;
      // Opus codes its low-frequency channel band-limited, so that channel carries a low tone.
      const source = testSignal(one.layout.roles.length, frames, one.rate).map((plane, channel) =>
        one.layout.roles[channel] === ChannelRole.LowFrequency
          ? plane.map((_, frame) => 0.5 * Math.sin((2 * Math.PI * 50 * frame) / one.rate))
          : plane,
      );
      const file = await encodeWhole(exportRequest(one.encoding, one.rate, one.layout), source);
      const session = expectSuccess(module.openDecoder(memoryBytes(file)));
      expect(session.description).toMatchObject({
        sampleRate: one.encoding.format === 'opus' ? 48_000 : one.rate,
        channelCount: one.layout.roles.length,
        totalFrames: frames,
      });
      const decoded = decodeAll(session);
      session.release();
      expect(decoded.map((plane) => plane.length)).toEqual(source.map(() => frames));
      const target = exportTarget(one.encoding);
      const order = expectSuccess(writtenChannelOrder(target.codec, target.container, one.layout));
      const written = order.map((index) => source[index] ?? new Float32Array(frames));
      expect(snrDb(written, decoded)).toBeGreaterThan(one.floorDb);
    },
    ENCODING_TIMEOUT_MS,
  );
});

describe('the reproducibility of lossy exports', () => {
  /** Each encoder's file of the test signal, by the hash every machine gives it. */
  const HASHES: readonly (readonly [FormatEncoding, string])[] = [
    [
      { format: 'mp3', encoding: { mode: 'constant', bitRate: 192 } },
      '44e6b5e6c8329b9d02f9223f7bb9eb4ba49f6104ca96404a0732148992c4eec7',
    ],
    [
      { format: 'mp3', encoding: { mode: 'average', bitRate: 160 } },
      '216e85625f0ef56868799dd2e6f5651bd17f07cde8fe2d352c0e5e43fd5943a5',
    ],
    [
      { format: 'mp3', encoding: { mode: 'variable', quality: 2 } },
      '8b78ad77d7fc54f52152e0005fdc3e43f4a6d9144020f0b20a0cde9571846617',
    ],
    [
      { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 6 } },
      '0b78e48ddfc08eaf0170ba732cbc11f28af5d2c9382e53531d03b410704c40bb',
    ],
    [
      { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 128 } },
      'af46702bbea8faa7d596997f65e53246a07206371c9d34f17dd1cc29dd86e479',
    ],
    [
      {
        format: 'opus',
        encoding: { bitRate: 160, application: 'audio', frameDuration: 20, complexity: 10 },
      },
      '2f5b9261c5b08986a4105ddcd0fdbf7f6b8f5d9086f5414165ac9e3089e2d5ae',
    ],
  ];

  it(
    'gives the same bytes for the same blocks and settings, however they are blocked',
    async () => {
      const source = testSignal(2, 48_000, 48_000);
      const hashes: string[] = [];
      for (const [encoding] of HASHES) {
        const request = exportRequest(encoding, 48_000);
        const first = await encodeWhole(request, source);
        for (const block of [1_777, 512, 48_000]) {
          expect(await encodeWhole(request, source, undefined, block)).toEqual(first);
        }
        hashes.push(sha256(first));
      }
      expect(hashes).toEqual(HASHES.map(([, hash]) => hash));
    },
    ENCODING_TIMEOUT_MS,
  );
});
