/**
 * The AIFF and AIFF-C writer: every type it writes read back by `openAudio`,
 * every layout a `CHAN` chunk can state given back in its own order, the
 * layouts it cannot refused naming WAV, `ima4`'s whole packets, the metadata
 * AIFF holds, and the stream's limits through the writer every format shares.
 */

import {
  ChannelRole,
  StandardLayouts,
  ambisonicLayout,
  discreteLayout,
  labelledLayout,
  sampleRate,
  succeed,
  type ChannelLayout,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import {
  createAiffWriter,
  type AiffSampleFormat,
  type AiffWriterSettings,
} from './aiff-file-writer.js';
import { readAiffMetadata } from './aiff-metadata.js';
import { encoderOf } from './frame-encoding.js';
import { compressAlaw, compressUlaw } from './g711.js';
import { openAudio } from './index.js';
import { quantiseSample } from './sample-quantisation.js';
import { streamingWriter } from './streaming-writer.js';
import { memoryBytes, writeWhole } from './testing/index.js';
import { referenceAlaw, referenceIma4, referenceUlaw } from './testing/reference-decoders.js';
import { referenceIma4Encode } from './testing/reference-encoders.js';
import { unwritableFile } from './codec-failures.js';

const RATE = expectSuccess(sampleRate(44_100));

const sine = (index: number, frames: number) =>
  Float32Array.from({ length: frames }, (_, frame) =>
    frame % 500 === 7 ? 1.5 : 0.7 * Math.sin((2 * Math.PI * (200 + 50 * index) * frame) / 44_100),
  );

function settings(
  layout: ChannelLayout,
  extra: Partial<AiffWriterSettings> = {},
): AiffWriterSettings {
  return {
    container: 'aifc',
    sampleRate: RATE,
    layout,
    sampleFormat: { kind: 'integer', bits: 16, byteOrder: 'big' },
    metadata: {},
    ...extra,
  };
}

async function roundTrip(
  layout: ChannelLayout,
  extra: Partial<AiffWriterSettings> = {},
  frames = 1_000,
) {
  const opened = expectSuccess(createAiffWriter(settings(layout, extra)));
  const channels = layout.roles.map((_, index) => sine(index, frames));
  const { file, finished } = await writeWhole(opened.writer, channels, 333);
  const reader = expectSuccess(await openAudio(memoryBytes(file)));
  const into = channels.map(() => new Float32Array(reader.format.frames));
  expectSuccess(await reader.read(0 as SampleCount, reader.format.frames, into));
  return { file, finished, reader, channels, into };
}

/** What each sample format reads back as, from the signal and, for `ima4`, from the bytes written. */
function expected(
  format: AiffSampleFormat,
  channel: Float32Array,
  file: Uint8Array,
  index: number,
  count: number,
  dataOffset: number,
  frames: number,
): number[] {
  switch (format.kind) {
    case 'integer':
      return Array.from(channel, (value) =>
        Math.fround((quantiseSample(value, format.bits) + 0) / 2 ** (format.bits - 1)),
      );
    case 'float':
      return Array.from(channel);
    case 'g711-alaw':
      return Array.from(
        channel,
        (value) => referenceAlaw(compressAlaw(quantiseSample(value, 16))) / 32_768,
      );
    case 'g711-ulaw':
      return Array.from(
        channel,
        (value) => referenceUlaw(compressUlaw(quantiseSample(value, 16))) / 32_768,
      );
    case 'ima-adpcm':
      return (referenceIma4(file.subarray(dataOffset), count, frames / 64)[index] ?? []).map(
        (value) => value / 32_768,
      );
  }
}

const FORMATS: readonly [AiffWriterSettings['container'], AiffSampleFormat][] = [
  ['aiff', { kind: 'integer', bits: 8, byteOrder: 'big' }],
  ['aiff', { kind: 'integer', bits: 16, byteOrder: 'big' }],
  ['aiff', { kind: 'integer', bits: 24, byteOrder: 'big' }],
  ['aiff', { kind: 'integer', bits: 32, byteOrder: 'big' }],
  ['aifc', { kind: 'integer', bits: 16, byteOrder: 'little' }],
  ['aifc', { kind: 'integer', bits: 24, byteOrder: 'little' }],
  ['aifc', { kind: 'float', bits: 32 }],
  ['aifc', { kind: 'float', bits: 64 }],
  ['aifc', { kind: 'g711-alaw' }],
  ['aifc', { kind: 'g711-ulaw' }],
  ['aifc', { kind: 'ima-adpcm' }],
];

const ambisonic = (
  order: number,
  ordering: 'acn' | 'fuma',
  normalisation: 'sn3d' | 'n3d' | 'fuma',
) => expectSuccess(ambisonicLayout({ order, ordering, normalisation }));

const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.surround5_1,
  StandardLayouts.surround7_1,
  StandardLayouts.surround7_1_4,
  expectSuccess(discreteLayout(2)),
  expectSuccess(discreteLayout(16)),
  { roles: [ChannelRole.Centre] },
  { roles: [ChannelRole.Discrete, ChannelRole.Right, ChannelRole.Left] },
  ambisonic(1, 'acn', 'sn3d'),
  ambisonic(2, 'acn', 'n3d'),
  ambisonic(1, 'fuma', 'fuma'),
];

describe.each(FORMATS)('an %s file of %j', (container, format) => {
  it('reads back in every layout CHAN can state, in the layout and order it was given', async () => {
    for (const layout of LAYOUTS) {
      const frames = 1_280;
      const { file, reader, channels, into } = await roundTrip(
        layout,
        { container, sampleFormat: format },
        frames,
      );
      expect(reader.format).toMatchObject({
        container,
        sampleRate: 44_100,
        frames,
        declaredFrames: frames,
        layout,
      });
      if (format.kind === 'ima-adpcm') {
        const reference = referenceIma4Encode(
          channels.map((channel) => Array.from(channel, (value) => quantiseSample(value, 16))),
        );
        expect(file.subarray(reader.format.dataOffset)).toEqual(reference);
      }
      for (const [index, samples] of into.entries()) {
        const want = expected(
          format,
          channels[index] ?? new Float32Array(),
          file,
          index,
          layout.roles.length,
          reader.format.dataOffset,
          frames,
        );
        const first = Array.from(samples).findIndex(
          (value, frame) => value !== Math.fround(want[frame] ?? Number.NaN),
        );
        expect(
          first === -1 ? undefined : { layout: layout.roles.length, index, frame: first },
        ).toBeUndefined();
      }
    }
  });
});

describe('the layouts and forms an AIFF file cannot hold', () => {
  it('refuses named channels and Furse-Malham above the first order, naming WAV', () => {
    for (const layout of [
      expectSuccess(labelledLayout(['Kick', 'Snare'])),
      ambisonic(2, 'fuma', 'fuma'),
    ]) {
      const refused = createAiffWriter(settings(layout));
      expect(expectFailureCode(refused)).toBe('codecs.layout-unwritable');
      expect(refused.ok ? '' : refused.failures[0].summary).toContain('WAV can hold it.');
    }
  });

  it('refuses any sample but big-endian integers in plain AIFF', () => {
    for (const sampleFormat of [
      { kind: 'float', bits: 32 },
      { kind: 'g711-alaw' },
      { kind: 'integer', bits: 16, byteOrder: 'little' },
    ] as const) {
      expect(
        expectFailureCode(
          createAiffWriter(settings(StandardLayouts.mono, { container: 'aiff', sampleFormat })),
        ),
      ).toBe('codecs.write-invalid');
    }
  });

  it('writes no CHAN chunk where the default is the layout', async () => {
    for (const layout of [
      StandardLayouts.mono,
      StandardLayouts.stereo,
      expectSuccess(discreteLayout(3)),
    ]) {
      const { file } = await roundTrip(layout);
      expect(String.fromCharCode(...file)).not.toContain('CHAN');
    }
  });
});

describe('ima4 packets', () => {
  it('ends a stream inside a packet with silence to the packet’s end', async () => {
    const { reader, channels, into, file } = await roundTrip(
      StandardLayouts.stereo,
      { sampleFormat: { kind: 'ima-adpcm' } },
      100,
    );
    expect(reader.format).toMatchObject({ frames: 128, declaredFrames: 128 });
    const decoded = referenceIma4(file.subarray(reader.format.dataOffset), 2, 2);
    for (const [index, samples] of into.entries()) {
      expect(Array.from(samples)).toEqual((decoded[index] ?? []).map((value) => value / 32_768));
    }
    expect(channels[0]?.length).toBe(100);
  });
});

describe('the metadata of an AIFF export', () => {
  it('writes the parts AIFF holds, which read back, and names the rest as dropped', async () => {
    const metadata = {
      text: { title: 'Bell', copyright: '2026 example.com', genre: 'Foley' },
      loops: [
        {
          start: 10 as SampleCount,
          length: 500 as SampleCount,
          playCount: 'endless' as const,
          direction: 'alternating' as const,
        },
      ],
      broadcast: {
        description: 'x',
        originator: 'y',
        originatorReference: 'z',
        originationDate: '2026-10-10',
        originationTime: '12:00:00',
        timeReference: 0 as SampleCount,
        codingHistory: '',
      },
    };
    const { file, finished } = await roundTrip(StandardLayouts.mono, { metadata });
    expect(finished.dropped).toEqual(
      expect.arrayContaining([{ kind: 'text', key: 'genre' }, { kind: 'broadcast' }]),
    );
    const read = expectSuccess(await readAiffMetadata(memoryBytes(file)));
    expect(read.text).toMatchObject({ title: 'Bell', copyright: '2026 example.com' });
    expect(read.loops).toMatchObject([{ start: 10, length: 500, direction: 'alternating' }]);
  });
});

describe('the limits of a stream', () => {
  const limited = (maximumDataLength: number, maximumFrames: number) =>
    streamingWriter({
      order: [0],
      encoder: encoderOf(
        { kind: 'integer', bits: 16, bytes: 2, byteOrder: 'big', signed: true },
        1,
      ),
      maximumDataLength,
      maximumFrames,
      tooLong: () => unwritableFile('Too long.'),
      head: () => succeed(new Uint8Array(0)),
      dropped: [],
    });

  it('refuses the block that would pass the most bytes or frames the format holds, and ends', async () => {
    const bytes = limited(10, 100);
    expectSuccess(await bytes.write([new Float32Array(4)], 4));
    expect(expectFailureCode(await bytes.write([new Float32Array(4)], 4))).toBe(
      'codecs.file-unwritable',
    );
    expect(expectFailureCode(await bytes.finish())).toBe('codecs.write-invalid');
    const frames = limited(1_000, 5);
    expect(expectFailureCode(await frames.write([new Float32Array(6)], 6))).toBe(
      'codecs.file-unwritable',
    );
  });
});
