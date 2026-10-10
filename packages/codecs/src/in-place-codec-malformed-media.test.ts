/**
 * The refusals of the compressed codes read in place (ADR-0090): format chunks
 * whose block layout cannot be, blocks whose headers break their codec's rules,
 * and a fuzz of damaged ADPCM and G.711 files that must only ever be answered,
 * never thrown.
 */

import type { SampleCount } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { openAudio } from './index.js';
import {
  memoryBytes,
  random,
  writeCompressedWav,
  type CompressedWavOptions,
} from './testing/index.js';

const STANDARD: readonly (readonly [number, number])[] = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232],
];

/** Two stereo IMA blocks of 256 bytes whose headers are sound: step index 0. */
const ima = (extra: Partial<CompressedWavOptions> = {}) =>
  writeCompressedWav({
    sampleRate: 22_050,
    channelCount: 2,
    coding: { kind: 'ima-adpcm', blockAlign: 256, framesPerBlock: 249 },
    data: new Uint8Array(512),
    factFrames: 498,
    ...extra,
  });

/** Two stereo Microsoft ADPCM blocks of 512 bytes whose headers choose pair 0 and delta 16. */
const ms = (extra: Partial<CompressedWavOptions> = {}) => {
  const data = new Uint8Array(1_024);
  for (const block of [0, 512]) data.set([0, 0, 16, 0, 16, 0], block);
  return writeCompressedWav({
    sampleRate: 22_050,
    channelCount: 2,
    coding: { kind: 'ms-adpcm', blockAlign: 512, framesPerBlock: 500, coefficients: STANDARD },
    data,
    factFrames: 1_000,
    ...extra,
  });
};

/** The offset of the header of the first chunk with this id. */
function chunkAt(file: Uint8Array, id: string): number {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  for (let at = 12; at + 8 <= file.length;) {
    if (String.fromCharCode(...file.subarray(at, at + 4)) === id) return at;
    const size = view.getUint32(at + 4, true);
    at += 8 + size + (size % 2);
  }
  throw new Error(`The fixture has no '${id}' chunk.`);
}

describe('a compressed format chunk whose block layout cannot be', () => {
  const imaCoding = (blockAlign: number, framesPerBlock: number) => ({
    coding: { kind: 'ima-adpcm' as const, blockAlign, framesPerBlock },
  });
  const msCoding = (blockAlign: number, framesPerBlock: number, coefficients = STANDARD) => ({
    coding: { kind: 'ms-adpcm' as const, blockAlign, framesPerBlock, coefficients },
  });

  const cases: readonly [string, () => Uint8Array, RegExp][] = [
    ['an IMA block align of zero', () => ima(imaCoding(0, 1)), /which 0 bytes are not/u],
    [
      'an IMA block that is not a header and whole groups',
      () => ima(imaCoding(257, 249)),
      /8-byte header and whole 8-byte groups, which 257 bytes are not/u,
    ],
    [
      'IMA blocks of no samples',
      () => ima(imaCoding(256, 0)),
      /0 samples in each IMA ADPCM block/u,
    ],
    [
      'more IMA samples per block than the block holds',
      () => ima(imaCoding(256, 250)),
      /250 samples in each IMA ADPCM block, where its 256 bytes hold 1 to 249/u,
    ],
    [
      'an IMA format chunk too short for its samples per block',
      () => ima({ formatOverrides: { extraBytes: 0 } }),
      /too short to hold IMA ADPCM's block layout/u,
    ],
    [
      'Microsoft ADPCM blocks shorter than their headers',
      () => ms(msCoding(10, 2)),
      /each 10-byte Microsoft ADPCM block of 2 channels, which cannot hold them/u,
    ],
    [
      'more Microsoft ADPCM samples per block than the block holds',
      () => ms(msCoding(512, 501)),
      /501 samples in each 512-byte Microsoft ADPCM block/u,
    ],
    [
      'no Microsoft ADPCM coefficients',
      () => ms({ formatOverrides: { coefficientCount: 0 } }),
      /0 Microsoft ADPCM coefficient pairs, where it holds 1 to 7/u,
    ],
    [
      'more Microsoft ADPCM coefficients than the chunk holds',
      () => ms({ formatOverrides: { coefficientCount: 50 } }),
      /50 Microsoft ADPCM coefficient pairs, where it holds 1 to 7/u,
    ],
    [
      'more Microsoft ADPCM coefficients than any file needs',
      () =>
        ms(
          msCoding(
            512,
            500,
            Array.from({ length: 300 }, () => [256, 0] as const),
          ),
        ),
      /300 Microsoft ADPCM coefficient pairs, where it holds 1 to 256/u,
    ],
    [
      'G.711 samples of 16 bits',
      () =>
        writeCompressedWav({
          sampleRate: 8_000,
          channelCount: 1,
          coding: { kind: 'g711-alaw' },
          data: new Uint8Array(16),
          formatOverrides: { bitsPerSample: 16 },
        }),
      /16-bit G.711 samples, which are always 8 bits/u,
    ],
    [
      'G.711 frames of the wrong size',
      () => {
        const file = writeCompressedWav({
          sampleRate: 8_000,
          channelCount: 2,
          coding: { kind: 'g711-ulaw' },
          data: new Uint8Array(16),
        });
        new DataView(file.buffer).setUint16(chunkAt(file, 'fmt ') + 8 + 12, 3, true);
        return file;
      },
      /3 bytes per frame, but 2 channels of 1-byte samples take 2/u,
    ],
    [
      'a fact chunk too short for its frame count',
      () =>
        writeCompressedWav({
          sampleRate: 22_050,
          channelCount: 2,
          coding: { kind: 'ima-adpcm', blockAlign: 256, framesPerBlock: 249 },
          data: new Uint8Array(512),
          beforeData: [{ id: 'fact', body: Uint8Array.of(1, 2) }],
        }),
      /fact chunk is shorter than the 4 bytes/u,
    ],
  ];

  it.each(cases)('refuses %s, saying what is wrong', async (_, file, sentence) => {
    const result = await openAudio(memoryBytes(file()));
    expect(expectFailureCode(result)).toBe('codecs.malformed');
    expect(result.ok ? '' : result.failures[0].summary).toMatch(sentence);
  });

  it('names IMA ADPCM of other than four bits, which it does not read in place', async () => {
    const result = await openAudio(memoryBytes(ima({ formatOverrides: { bitsPerSample: 3 } })));
    expect(expectFailureCode(result)).toBe('codecs.unsupported-format');
    expect(result.ok ? '' : result.failures[0].summary).toContain(
      'WAV audio compressed as IMA ADPCM of 3 bits a sample.',
    );
  });
});

describe('a block whose header breaks its codec’s rules', () => {
  it('fails the read of an IMA block whose step index is past 88, and reads the blocks before it', async () => {
    const file = ima();
    // The second block's second channel.
    file[chunkAt(file, 'data') + 8 + 256 + 4 + 2] = 89;
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    const into = [new Float32Array(498), new Float32Array(498)];
    expect(expectSuccess(await reader.read(0 as SampleCount, 249, into))).toBe(249);
    const failed = await reader.read(200 as SampleCount, 100, into);
    expect(expectFailureCode(failed)).toBe('codecs.malformed');
    expect(failed.ok ? '' : failed.failures[0].summary).toMatch(
      /step index 89, past the last, 88/u,
    );
  });

  it('fails the read of a Microsoft ADPCM block that chooses a pair the table lacks', async () => {
    const file = ms();
    file[chunkAt(file, 'data') + 8 + 512] = 7;
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    const into = [new Float32Array(1_000), new Float32Array(1_000)];
    expect(expectSuccess(await reader.read(0 as SampleCount, 500, into))).toBe(500);
    const failed = await reader.read(0 as SampleCount, 1_000, into);
    expect(failed.ok ? '' : failed.failures[0].summary).toMatch(
      /chooses coefficient pair 7, where the format chunk lists 7/u,
    );
  });
});

describe('the length a compressed file declares', () => {
  it('takes an RF64 fact chunk of 0xFFFFFFFF from the ds64 chunk’s sample count', async () => {
    const file = ima({ form: 'rf64', factFrames: 300 });
    new DataView(file.buffer).setUint32(chunkAt(file, 'fact') + 8, 0xffffffff, true);
    expect(expectSuccess(await openAudio(memoryBytes(file))).format.frames).toBe(300);
  });

  it('refuses a WAV fact chunk of 0xFFFFFFFF, which has no ds64 chunk to defer to', async () => {
    const file = ima({ factFrames: 0xffffffff });
    expect(expectFailureCode(await openAudio(memoryBytes(file)))).toBe('codecs.malformed');
  });

  it('reads a fact chunk past the blocks present as a file cut short', async () => {
    const reader = expectSuccess(await openAudio(memoryBytes(ima({ factFrames: 1_000 }))));
    expect(reader.format).toMatchObject({ frames: 498, declaredFrames: 1_000 });
  });
});

describe('cancelling a compressed read', () => {
  it('rejects with the signal’s reason when cancelled during a read', async () => {
    const controller = new AbortController();
    const reason = new Error('Playback stopped.');
    const file = ms();
    const bytes = memoryBytes(file, {
      answer: (request, honest) => {
        if (request.length >= 512) controller.abort(reason);
        return honest;
      },
    });
    const reader = expectSuccess(await openAudio(bytes));
    const into = [new Float32Array(1_000), new Float32Array(1_000)];
    await expect(reader.read(0 as SampleCount, 1_000, into, controller.signal)).rejects.toBe(
      reason,
    );
  });
});

describe('damaged compressed files', () => {
  const bases: readonly Uint8Array[] = [
    ima(),
    ms(),
    writeCompressedWav({
      sampleRate: 8_000,
      channelCount: 3,
      coding: { kind: 'g711-ulaw' },
      data: Uint8Array.from({ length: 300 }, (_, at) => at),
      factFrames: 100,
    }),
  ];

  it('answers every one of three hundred mutations with a result and never throws', async () => {
    const next = random(909);
    const outcomes = { opened: 0, refused: 0 };
    for (let trial = 0; trial < 300; trial += 1) {
      const base = bases[trial % bases.length]!;
      const file = base.slice(0, next() < 0.1 ? Math.floor(next() * base.length) : base.length);
      const mutations = 1 + Math.floor(next() * 4);
      for (let count = 0; count < mutations; count += 1) {
        // The format chunk, the fact chunk and the first block's header.
        file[Math.floor(next() * Math.min(file.length, 140))] = Math.floor(next() * 256);
      }
      const result = await openAudio(memoryBytes(file));
      if (!result.ok) {
        outcomes.refused += 1;
        continue;
      }
      outcomes.opened += 1;
      const frames = Math.min(result.value.format.frames, 4_096);
      const into = Array.from(
        { length: result.value.format.channelCount },
        () => new Float32Array(frames),
      );
      const read = await result.value.read(0 as SampleCount, frames, into);
      expect(read.ok ? 'read' : read.failures[0].code).toMatch(/^(read|codecs\.malformed)$/u);
    }
    expect(outcomes.opened).toBeGreaterThan(40);
    expect(outcomes.refused).toBeGreaterThan(40);
  });
});
