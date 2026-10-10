/**
 * Lossless exports, round trip and reproducibility (ADR-0091): WAV, AIFF and
 * AIFF-C read back bit for bit by the codecs' own readers, FLAC by the codec
 * module's decoder, each against the source as the export's quantiser made
 * it; and the same blocks and settings give the same bytes, whose hashes are
 * held here.
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
  it('give back integer samples bit for bit, as the quantiser made them', async () => {
    const source = testSignal(2, FRAMES, RATE);
    const cases: readonly (readonly [FormatEncoding, number])[] = [
      [{ format: 'wav', encoding: { kind: 'integer', bits: 16 } }, 16],
      [{ format: 'wav', encoding: { kind: 'integer', bits: 24 } }, 24],
      [{ format: 'wav', encoding: { kind: 'integer', bits: 8 } }, 8],
      [{ format: 'aiff', encoding: { kind: 'integer', bits: 24 } }, 24],
      [{ format: 'aifc', encoding: { kind: 'integer', bits: 16 } }, 16],
    ];
    for (const [encoding, bits] of cases) {
      const file = await encodeWhole(exportRequest(encoding, RATE), source);
      const read = await readWhole(file);
      quantised(source, bits).forEach((plane, channel) => {
        expect(integers(read[channel] ?? [], bits)).toEqual(integers(plane, bits));
      });
    }
  });

  it('dithers before quantising, the noise drawn under the file’s key', async () => {
    const source = testSignal(2, FRAMES, RATE);
    const dither: DitherSettings = {
      kind: 'triangular',
      amplitude: 1,
      shaping: 'first-order',
      seed: 0,
    };
    const request = {
      ...exportRequest({ format: 'wav', encoding: { kind: 'integer', bits: 16 } }, RATE),
      dither,
      ditherKey: 0x5eed,
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
  });

  it('writes a 32-bit integer export exactly, every sample the integer its dither chose', async () => {
    const source = testSignal(1, 4_001, RATE);
    const dither: DitherSettings = { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 7 };
    const request = {
      ...exportRequest(
        { format: 'wav', encoding: { kind: 'integer', bits: 32 } },
        RATE,
        StandardLayouts.mono,
      ),
      dither,
      ditherKey: 99,
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
  });

  it('gives back floating-point samples bit for bit', async () => {
    const source = testSignal(2, FRAMES, RATE);
    for (const encoding of [
      { format: 'wav', encoding: { kind: 'float', bits: 32 } },
      { format: 'wav', encoding: { kind: 'float', bits: 64 } },
      { format: 'aifc', encoding: { kind: 'float', bits: 32 } },
    ] as const) {
      const read = await readWhole(await encodeWhole(exportRequest(encoding, RATE), source));
      expect(read).toEqual(source);
    }
  });
});

describe('FLAC exports, decoded by the codec module', () => {
  it('give back every depth bit for bit, in FLAC’s own channel order', async () => {
    const module = await codecModule();
    const cases: readonly (readonly [16 | 24, ChannelLayout, number])[] = [
      [16, StandardLayouts.stereo, 5],
      [24, StandardLayouts.mono, 8],
      [16, StandardLayouts.surround5_1, 0],
      [24, StandardLayouts.surround7_1, 2],
    ];
    for (const [bits, layout, level] of cases) {
      const source = testSignal(layout.roles.length, FRAMES, RATE);
      const file = await encodeWhole(
        exportRequest(
          { format: 'flac', encoding: { bits, compressionLevel: level } },
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
  });
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
      { format: 'flac', encoding: { bits: 16, compressionLevel: 5 } },
      'afead68c20b3629aff6c6aa35f8156b708c671008ed22470fc382f09e37f2711',
    ],
    [
      { format: 'flac', encoding: { bits: 24, compressionLevel: 8 } },
      '94c1e29a7afa8dcb09d2f17c94606b169acc85cfd3f74ecc30e33dc627c0d623',
    ],
  ];

  it('gives the same bytes for the same blocks and settings, however they are blocked', async () => {
    const source = testSignal(2, FRAMES, RATE);
    const dither: DitherSettings = { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 3 };
    const hashes: string[] = [];
    for (const [encoding] of HASHES) {
      // Dither is added before an integer encoder alone.
      const floating = encoding.format === 'aifc' && encoding.encoding.kind === 'float';
      const request = {
        ...exportRequest(encoding, RATE),
        dither: floating ? { kind: 'none' as const } : dither,
        ditherKey: 1234,
      };
      const first = await encodeWhole(request, source);
      for (const block of [1_777, 512, 48_000]) {
        expect(await encodeWhole(request, source, undefined, block)).toEqual(first);
      }
      hashes.push(sha256(first));
    }
    expect(hashes).toEqual(HASHES.map(([, hash]) => hash));
  });
});
