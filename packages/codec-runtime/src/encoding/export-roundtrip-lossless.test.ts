/**
 * Lossless exports, round trip and reproducibility (ADR-0091): WAV, AIFF and
 * AIFF-C read back bit for bit by the codecs' own readers, FLAC by the codec
 * module's decoder, each against the source as the export's quantiser made
 * it, at depths that fill their containers and at depths short of them; and
 * the same blocks and settings give the same bytes, whose hashes are held
 * here, for both ADPCM codes, flacenc and the module's own FLAC encoder.
 */

import { createHash } from 'node:crypto';

import {
  FlacSampleDigest,
  openAudio,
  quantiseSample,
  writtenChannelOrder,
} from '@audiogubbins/codecs';
import { memoryBytes as memoryAudioBytes } from '@audiogubbins/codecs/testing';
import { StandardLayouts, type ChannelLayout, type SampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { Quantiser, type DitherSettings, type FormatEncoding } from '@audiogubbins/import-export';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import { decodeAll, encodeWhole, exportRequest, testSignal } from '../testing/export-encoding.js';
import { memoryBytes } from '../testing/memory-bytes.js';

const RATE = 48_000;
const FRAMES = 30_011;

/** Each case encodes and decodes seconds of audio, several times over, in WebAssembly. */
const ENCODING_TIMEOUT_MS = 60_000;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The source as the export's quantiser makes it: each sample `k / 2^(bits-1)`. */
function quantised(
  source: readonly Float32Array[],
  bits: number,
  dither: DitherSettings = { kind: 'none' },
  key = 0,
): Float64Array[] {
  const out = source.map((plane) => new Float64Array(plane.length));
  new Quantiser({ bits, dither, key, channels: source.length }).quantise(
    source,
    source[0]?.length ?? 0,
    out,
  );
  return out;
}

/** Every frame of a WAV or AIFF file, as the codecs' reader gives it. */
async function readWhole(file: Uint8Array): Promise<Float32Array[]> {
  const reader = expectSuccess(await openAudio(memoryAudioBytes(file)));
  const frames = reader.format.frames;
  const into = Array.from({ length: reader.format.channelCount }, () => new Float32Array(frames));
  expect(expectSuccess(await reader.read(0 as SampleCount, frames, into))).toBe(frames);
  return into;
}

/** A plane's samples as the integers of `bits` bits they are. */
const integers = (plane: ArrayLike<number>, bits: number): Int32Array =>
  Int32Array.from(plane, (sample) => sample * 2 ** (bits - 1));

describe('WAV, AIFF and AIFF-C exports, read back by the codecs', () => {
  it(
    'give back integer samples bit for bit, as the quantiser made them',
    async () => {
      const source = testSignal(2, FRAMES, RATE);
      const cases: readonly (readonly [FormatEncoding, number])[] = [
        [{ format: 'wav', encoding: { kind: 'integer', bits: 16 } }, 16],
        [{ format: 'wav', encoding: { kind: 'integer', bits: 24 } }, 24],
        [{ format: 'wav', encoding: { kind: 'integer', bits: 8 } }, 8],
        [{ format: 'aiff', encoding: { kind: 'integer', bits: 24 } }, 24],
        [{ format: 'aifc', encoding: { kind: 'integer', bits: 16 } }, 16],
        // Depths short of their containers, stated in WAV's valid bits and AIFF's sample size.
        [{ format: 'wav', encoding: { kind: 'integer', bits: 12 } }, 12],
        [{ format: 'wav', encoding: { kind: 'integer', bits: 20 } }, 20],
        [{ format: 'wav', encoding: { kind: 'integer', bits: 29 } }, 29],
        [{ format: 'aiff', encoding: { kind: 'integer', bits: 20 } }, 20],
        [{ format: 'aiff', encoding: { kind: 'integer', bits: 9 } }, 9],
        [{ format: 'aifc', encoding: { kind: 'integer', bits: 27 } }, 27],
      ];
      for (const [encoding, bits] of cases) {
        const file = await encodeWhole(exportRequest(encoding, RATE), source);
        const read = await readWhole(file);
        quantised(source, bits).forEach((plane, channel) => {
          expect(integers(read[channel] ?? [], bits)).toEqual(integers(plane, bits));
        });
      }
    },
    ENCODING_TIMEOUT_MS,
  );

  it(
    'dithers before quantising, the noise drawn under the file’s key',
    async () => {
      const source = testSignal(2, FRAMES, RATE);
      const dither: DitherSettings = {
        kind: 'triangular',
        amplitude: 1,
        shaping: 'first-order',
        seed: 0,
      };
      const request = {
        ...exportRequest({ format: 'wav', encoding: { kind: 'integer', bits: 16 } }, RATE),
        dither: { settings: dither, key: 0x5eed },
      };
      const read = await readWhole(await encodeWhole(request, source));
      const expected = quantised(source, 16, dither, 0x5eed);
      expected.forEach((plane, channel) => {
        expect(integers(read[channel] ?? [], 16)).toEqual(integers(plane, 16));
      });
      // Dither changes the integers an undithered export writes.
      expect(integers(expected[0] ?? [], 16)).not.toEqual(
        integers(quantised(source, 16)[0] ?? [], 16),
      );
    },
    ENCODING_TIMEOUT_MS,
  );

  it(
    'writes a 32-bit integer export exactly, every sample the integer its dither chose',
    async () => {
      const source = testSignal(1, 4_001, RATE);
      const dither: DitherSettings = { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 7 };
      const request = {
        ...exportRequest(
          { format: 'wav', encoding: { kind: 'integer', bits: 32 } },
          RATE,
          StandardLayouts.mono,
        ),
        dither: { settings: dither, key: 99 },
      };
      const file = await encodeWhole(request, source);
      const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
      const data = file.length - 4_001 * 4;
      const written = Int32Array.from({ length: 4_001 }, (_, frame) =>
        view.getInt32(data + frame * 4, true),
      );
      const expected = Int32Array.from(quantised(source, 32, dither, 99)[0] ?? [], (sample) =>
        quantiseSample(sample, 32),
      );
      expect(written).toEqual(expected);
      // A 32-bit float could not have held these: some are not k / 2^31 in single precision.
      expect(expected.some((value) => Math.fround(value / 2 ** 31) * 2 ** 31 !== value)).toBe(true);
    },
    ENCODING_TIMEOUT_MS,
  );

  it(
    'gives back floating-point samples bit for bit',
    async () => {
      const source = testSignal(2, FRAMES, RATE);
      for (const encoding of [
        { format: 'wav', encoding: { kind: 'float', bits: 32 } },
        { format: 'wav', encoding: { kind: 'float', bits: 64 } },
        { format: 'aifc', encoding: { kind: 'float', bits: 32 } },
      ] as const) {
        const read = await readWhole(await encodeWhole(exportRequest(encoding, RATE), source));
        expect(read).toEqual(source);
      }
    },
    ENCODING_TIMEOUT_MS,
  );
});

describe('FLAC exports, decoded by the codec module', () => {
  it(
    'give back every depth bit for bit, in FLAC’s own channel order',
    async () => {
      const module = await codecModule();
      const cases: readonly (readonly [number, ChannelLayout, number])[] = [
        [16, StandardLayouts.stereo, 5],
        [32, StandardLayouts.stereo, 5],
        [24, StandardLayouts.mono, 8],
        [16, StandardLayouts.surround5_1, 0],
        [24, StandardLayouts.surround7_1, 2],
        // flacenc's other depths, and the module's own encoder at depths flacenc has not.
        [12, StandardLayouts.stereo, 5],
        [20, StandardLayouts.stereo, 8],
        [4, StandardLayouts.stereo, 5],
        [13, StandardLayouts.mono, 2],
        [28, StandardLayouts.stereo, 5],
      ];
      for (const [bits, layout, level] of cases) {
        const source = testSignal(layout.roles.length, FRAMES, RATE);
        const file = await encodeWhole(
          exportRequest(
            { format: 'flac', encoding: { bits, compressionLevel: level, keepRiffChunks: false } },
            RATE,
            layout,
          ),
          source,
        );
        const session = expectSuccess(module.openDecoder(memoryBytes(file)));
        expect(session.description).toMatchObject({
          codec: 'flac',
          bitsPerSample: bits,
          totalFrames: FRAMES,
          channelCount: layout.roles.length,
        });
        const decoded = decodeAll(session);
        session.release();
        const order = expectSuccess(writtenChannelOrder('flac', 'flac', layout));
        const expected = quantised(source, bits);
        const written = order.map((index) => integers(expected[index] ?? [], bits));
        written.forEach((plane, channel) => {
          expect(integers(decoded[channel] ?? [], bits)).toEqual(plane);
        });
        // STREAMINFO's signature, after `fLaC`, the block's header and 18 bytes of fields.
        const digest = new FlacSampleDigest(bits);
        digest.add(written, FRAMES);
        expect(file.subarray(26, 42)).toEqual(digest.digest());
      }
    },
    ENCODING_TIMEOUT_MS,
  );
  it(
    'signs a dithered 32-bit stream with the MD5 of the very integers its dither chose',
    async () => {
      const source = testSignal(2, FRAMES, RATE);
      const dither: DitherSettings = {
        kind: 'triangular',
        amplitude: 1,
        shaping: 'none',
        seed: 5,
      };
      const request = {
        ...exportRequest(
          { format: 'flac', encoding: { bits: 32, compressionLevel: 5, keepRiffChunks: false } },
          RATE,
        ),
        dither: { settings: dither, key: 77 },
      };
      const file = await encodeWhole(request, source);
      const expected = quantised(source, 32, dither, 77).map((plane) =>
        Int32Array.from(plane, (sample) => quantiseSample(sample, 32)),
      );
      const digest = new FlacSampleDigest(32);
      digest.add(expected, FRAMES);
      expect(file.subarray(26, 42)).toEqual(digest.digest());
    },
    ENCODING_TIMEOUT_MS,
  );
});

describe('the reproducibility of lossless exports', () => {
  /** Each format's file of the test signal, by the hash every machine gives it. */
  const HASHES: readonly (readonly [FormatEncoding, string])[] = [
    [
      { format: 'wav', encoding: { kind: 'integer', bits: 24 } },
      '84570a834d41a5c92cdef6f1d0029efdf98dd53ee03604641a8cb64d201c8b99',
    ],
    [
      { format: 'aiff', encoding: { kind: 'integer', bits: 16 } },
      'bc22ca7aec8e61277d6fa68c2728152ea2a3e68dbb3bc09682041272f2987ccc',
    ],
    [
      { format: 'aifc', encoding: { kind: 'float', bits: 32 } },
      'eefd19ae8eb080b25c40f2fe8a67c67af34452c4e96f64145fd9149d3211cb46',
    ],
    [
      { format: 'flac', encoding: { bits: 16, compressionLevel: 5, keepRiffChunks: false } },
      'afead68c20b3629aff6c6aa35f8156b708c671008ed22470fc382f09e37f2711',
    ],
    [
      { format: 'flac', encoding: { bits: 24, compressionLevel: 8, keepRiffChunks: false } },
      '94c1e29a7afa8dcb09d2f17c94606b169acc85cfd3f74ecc30e33dc627c0d623',
    ],
    [
      { format: 'wav', encoding: { kind: 'ms-adpcm' } },
      'b96f0d3db843e7eeec30748b213fb2e56f38f55d472e944f22ed6342458f1a72',
    ],
    [
      { format: 'aifc', encoding: { kind: 'ima-adpcm' } },
      'd8000a5871a56bb8d560dfd0d5ed62f8c4a8202b190ca6e80c0b4bccd5c6da6b',
    ],
    // The codec module's own encoder, whose 32-bit frames flacenc cannot make.
    [
      { format: 'flac', encoding: { bits: 32, compressionLevel: 5, keepRiffChunks: false } },
      'bc3cf59ce534871f1678969de91765b56dfbb763193e923d236c855e9730f20b',
    ],
    [
      { format: 'wav', encoding: { kind: 'integer', bits: 20 } },
      '04ee5be8e21b50b29320d95047b16178925d81c47b024cdf98c23abb745c7ff0',
    ],
    [
      { format: 'wav', encoding: { kind: 'integer', bits: 12 } },
      '5eb9e7edf382e1664e22e3eaf99313f634fea21156d6df1f59729209f174214e',
    ],
    [
      { format: 'aiff', encoding: { kind: 'integer', bits: 20 } },
      'dc5411c0b017288131613488ec0c6749add229554b8a937bd8e731a29a4edda4',
    ],
    [
      { format: 'flac', encoding: { bits: 20, compressionLevel: 5, keepRiffChunks: false } },
      '6f0b46dfc0a7d4e64e4f0c32403c8d52b9d01c061cc2657b96fb639d49fc4b06',
    ],
    [
      { format: 'flac', encoding: { bits: 12, compressionLevel: 5, keepRiffChunks: false } },
      '0372fb5aa54478a47adc72634218c2db0fe64baa764ec31658f3928d6405c1f7',
    ],
    // The module's own encoder at a depth short of whole bytes.
    [
      { format: 'flac', encoding: { bits: 13, compressionLevel: 5, keepRiffChunks: false } },
      'aa2dad548463c44209e9ca290270b03d4fc52a264c1b1300ecb84ac28deb4c72',
    ],
  ];

  it(
    'gives the same bytes for the same blocks and settings, however they are blocked',
    async () => {
      const source = testSignal(2, FRAMES, RATE);
      const dither: DitherSettings = { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 3 };
      const hashes: string[] = [];
      for (const [encoding] of HASHES) {
        // Dither is added before an integer encoder alone.
        const floating = encoding.format === 'aifc' && encoding.encoding.kind === 'float';
        const request = {
          ...exportRequest(encoding, RATE),
          dither: { settings: floating ? { kind: 'none' as const } : dither, key: 1234 },
        };
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
