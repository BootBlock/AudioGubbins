/**
 * The WAV writer's layouts, forms, metadata and contract (ADR-0093, ADR-0090):
 * every domain layout stated so the reader gives it back, the plain and the
 * extensible form chosen by Microsoft's rule, the head's chunks and its switch
 * to RF64, and a writer that refuses what it cannot write and ends.
 */

import {
  type AmbisonicNormalisation,
  type AmbisonicOrdering,
  ChannelRole,
  StandardLayouts,
  ambisonicLayout,
  channelLayout,
  discreteLayout,
  labelledLayout,
  sampleRate,
  type ChannelLayout,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import type { AudioBytes } from './audio-bytes.js';
import { openAudio } from './index.js';
import { readRiffMetadata } from './riff-metadata.js';
import { memoryBytes, writeWhole } from './testing/index.js';
import {
  createWavWriter,
  type WavSampleFormat,
  type WavWriterSettings,
} from './wav-file-writer.js';
import { waveFormatChunk } from './wave-format-writing.js';
import { waveHeadPlan, writeWaveHead, type WaveHeadParts } from './wave-head.js';

const RATE = expectSuccess(sampleRate(48_000));
const PCM16: WavSampleFormat = { kind: 'integer', bits: 16 };

/** Channel `index` of a test signal: a ramp of whole 16-bit steps, distinct in every channel. */
const ramp = (index: number, frames: number) =>
  Float32Array.from(
    { length: frames },
    (_, frame) => ((frame * 7 + index * 1_001) % 30_000) / 32_768,
  );

function settings(
  layout: ChannelLayout,
  extra: Partial<WavWriterSettings> = {},
): WavWriterSettings {
  return { form: 'riff', sampleRate: RATE, layout, sampleFormat: PCM16, metadata: {}, ...extra };
}

/** Writes a ramp in `layout` and opens it, with the file and the layout the writer stated. */
async function roundTrip(
  layout: ChannelLayout,
  extra: Partial<WavWriterSettings> = {},
  frames = 600,
) {
  const opened = expectSuccess(createWavWriter(settings(layout, extra)));
  const channels = layout.roles.map((_, index) => ramp(index, frames));
  const { file, finished } = await writeWhole(opened.writer, channels, 250);
  const reader = expectSuccess(await openAudio(memoryBytes(file)));
  const into = channels.map(() => new Float32Array(frames));
  expect(expectSuccess(await reader.read(0 as SampleCount, frames, into))).toBe(frames);
  return { file, finished, stated: opened.layout, reader, channels, into };
}

const view = (file: Uint8Array) => new DataView(file.buffer, file.byteOffset, file.byteLength);
const text = (file: Uint8Array) => String.fromCharCode(...file);

/** The offset of the first chunk with this id. */
function chunkAt(file: Uint8Array, id: string): number | undefined {
  for (let at = 12; at + 8 <= file.length;) {
    if (String.fromCharCode(...file.subarray(at, at + 4)) === id) return at;
    const size = view(file).getUint32(at + 4, true);
    at += 8 + size + (size % 2);
  }
  return undefined;
}

/** Whether a role places its channel, so that it is found by its role alone. */
const positional = (role: ChannelRole) =>
  role !== ChannelRole.Discrete && role !== ChannelRole.Ambisonic;

/**
 * The channel of `given` each channel of `written` holds: a speaker by its
 * role, and the others in the order they came.
 */
function sourceIndices(given: ChannelLayout, written: ChannelLayout): readonly number[] {
  const others = given.roles.flatMap((role, index) => (positional(role) ? [] : [index]));
  let next = 0;
  return written.roles.map((role) => {
    if (positional(role)) return given.roles.indexOf(role);
    next += 1;
    return others[next - 1] ?? -1;
  });
}

const ambisonic = (
  order: number,
  ordering: AmbisonicOrdering,
  normalisation: AmbisonicNormalisation,
) => expectSuccess(ambisonicLayout({ order, ordering, normalisation }));

describe('the layout a WAV export states', () => {
  const {
    Left,
    Right,
    Centre,
    LowFrequency,
    RearLeft,
    RearRight,
    SurroundLeft,
    SurroundRight,
    Discrete,
  } = ChannelRole;
  const cases: readonly {
    name: string;
    layout: ChannelLayout;
    mask: number | 'plain';
    written?: ChannelLayout;
  }[] = [
    { name: 'mono', layout: StandardLayouts.mono, mask: 'plain' },
    { name: 'stereo', layout: StandardLayouts.stereo, mask: 'plain' },
    { name: 'quadraphonic', layout: StandardLayouts.quadraphonic, mask: 0x33 },
    { name: '5.1', layout: StandardLayouts.surround5_1, mask: 0x60f },
    {
      name: '7.1, its rear pair before its side pair as the mask orders them',
      layout: StandardLayouts.surround7_1,
      mask: 0x63f,
      written: {
        roles: [
          Left,
          Right,
          Centre,
          LowFrequency,
          RearLeft,
          RearRight,
          SurroundLeft,
          SurroundRight,
        ],
      },
    },
    {
      name: '7.1.4',
      layout: StandardLayouts.surround7_1_4,
      mask: 0x2d63f,
      written: {
        roles: [
          Left,
          Right,
          Centre,
          LowFrequency,
          RearLeft,
          RearRight,
          SurroundLeft,
          SurroundRight,
          ChannelRole.TopFrontLeft,
          ChannelRole.TopFrontRight,
          ChannelRole.TopRearLeft,
          ChannelRole.TopRearRight,
        ],
      },
    },
    { name: 'sixteen discrete channels', layout: expectSuccess(discreteLayout(16)), mask: 0 },
    {
      name: 'a discrete channel before a speaker pair, written after it',
      layout: { roles: [Discrete, Left, Right] },
      mask: 0x3,
      written: { roles: [Left, Right, Discrete] },
    },
    { name: 'one discrete channel', layout: expectSuccess(discreteLayout(1)), mask: 0 },
    { name: 'two discrete channels', layout: expectSuccess(discreteLayout(2)), mask: 0 },
    { name: 'the centre alone', layout: { roles: [Centre] }, mask: 0 },
    {
      name: 'named stems',
      layout: expectSuccess(labelledLayout(['Kick', 'Snare & Hat', '<Room>'])),
      mask: 0,
    },
    {
      name: 'named speakers',
      layout: expectSuccess(channelLayout([Left, Right], ['Dialogue L', 'Dialogue R'])),
      mask: 0x3,
    },
    { name: 'first-order AmbiX', layout: ambisonic(1, 'acn', 'sn3d'), mask: 0 },
    { name: 'third-order ACN N3D', layout: ambisonic(3, 'acn', 'n3d'), mask: 0 },
    { name: 'second-order Furse-Malham', layout: ambisonic(2, 'fuma', 'fuma'), mask: 0 },
  ];

  it.each(cases)('states $name so the reader gives it back', async ({ layout, mask, written }) => {
    const { file, stated, reader, channels, into } = await roundTrip(layout);
    const expected = written ?? layout;
    expect(stated).toEqual(expected);
    expect(reader.format.layout).toEqual(expected);
    const formatAt = chunkAt(file, 'fmt ') ?? 0;
    if (mask === 'plain') {
      expect(view(file).getUint16(formatAt + 8, true)).toBe(1);
      expect(reader.format.statedLayout).toBeUndefined();
    } else {
      expect(view(file).getUint16(formatAt + 8, true)).toBe(0xfffe);
      expect(view(file).getUint32(formatAt + 8 + 20, true)).toBe(mask);
      // Discrete channels past two are the format's default, which a header need not state.
      expect(reader.format.statedLayout).toEqual(
        expected.roles.length > 2 &&
          expected.roles.every((role) => role === Discrete) &&
          expected.labels === undefined
          ? undefined
          : expected,
      );
    }
    const sources = sourceIndices(layout, expected);
    expected.roles.forEach((_, index) => {
      expect(Array.from(into[index] ?? [])).toEqual(
        Array.from(channels[sources[index] ?? -1] ?? []),
      );
    });
  });

  it('names labelled channels in iXML’s own track list, for other tools', async () => {
    const { file } = await roundTrip(
      expectSuccess(labelledLayout(['Kick', 'Snare & Hat', '<Room>'])),
    );
    expect(text(file)).toContain(
      '<TRACK><CHANNEL_INDEX>2</CHANNEL_INDEX><INTERLEAVE_INDEX>2</INTERLEAVE_INDEX><NAME>Snare &amp; Hat</NAME></TRACK>',
    );
  });

  it('states a layout ADPCM’s plain form cannot in iXML alone', async () => {
    const { file, reader } = await roundTrip(
      StandardLayouts.surround5_1,
      { sampleFormat: { kind: 'ima-adpcm' } },
      2_000,
    );
    expect(view(file).getUint16((chunkAt(file, 'fmt ') ?? 0) + 8, true)).toBe(0x0011);
    expect(reader.format.layout).toEqual(StandardLayouts.surround5_1);
    expect(chunkAt(file, 'iXML')).toBeDefined();
  });

  it('believes the mask over an iXML statement that disagrees with it', async () => {
    const { file } = await roundTrip(
      expectSuccess(channelLayout([ChannelRole.Left, ChannelRole.Right], ['A', 'B'])),
    );
    const formatAt = chunkAt(file, 'fmt ') ?? 0;
    // Another tool swapped the mask's speakers to the surround pair and kept the statement.
    view(file).setUint32(formatAt + 8 + 20, 0x600, true);
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    expect(reader.format.layout.roles).toEqual([
      ChannelRole.SurroundLeft,
      ChannelRole.SurroundRight,
    ]);
    expect(reader.format.layout.labels).toBeUndefined();
  });
});

describe('the form and the chunks of a WAV export', () => {
  /** Each sample format, named for the title, with its format tag and its `fact` length. */
  const formats: readonly {
    readonly name: string;
    readonly format: WavSampleFormat;
    readonly tag: number;
    readonly fact: number | undefined;
  }[] = [
    { name: 'integer 8', format: { kind: 'integer', bits: 8 }, tag: 1, fact: undefined },
    { name: 'integer 16', format: { kind: 'integer', bits: 16 }, tag: 1, fact: undefined },
    { name: 'integer 24', format: { kind: 'integer', bits: 24 }, tag: 0xfffe, fact: undefined },
    { name: 'integer 32', format: { kind: 'integer', bits: 32 }, tag: 0xfffe, fact: undefined },
    { name: 'float 32', format: { kind: 'float', bits: 32 }, tag: 3, fact: 600 },
    { name: 'float 64', format: { kind: 'float', bits: 64 }, tag: 3, fact: 600 },
    { name: 'G.711 A-law', format: { kind: 'g711-alaw' }, tag: 6, fact: 600 },
    { name: 'G.711 µ-law', format: { kind: 'g711-ulaw' }, tag: 7, fact: 600 },
    { name: 'IMA ADPCM', format: { kind: 'ima-adpcm' }, tag: 0x11, fact: 600 },
    { name: 'Microsoft ADPCM', format: { kind: 'ms-adpcm' }, tag: 2, fact: 600 },
  ];

  it.each(formats)(
    'writes stereo $name with format tag $tag, and a fact chunk where it is not integer PCM',
    async ({ format, tag, fact }) => {
      const { file, reader } = await roundTrip(StandardLayouts.stereo, { sampleFormat: format });
      expect(view(file).getUint16((chunkAt(file, 'fmt ') ?? 0) + 8, true)).toBe(tag);
      const factAt = chunkAt(file, 'fact');
      expect(factAt === undefined ? undefined : view(file).getUint32(factAt + 8, true)).toBe(fact);
      expect(reader.format.frames).toBe(600);
      expect(file.length).toBe(view(file).getUint32(4, true) + 8);
    },
  );

  it('pads odd data with a byte the form counts, and reads every frame', async () => {
    const { file, reader } = await roundTrip(
      StandardLayouts.mono,
      { sampleFormat: { kind: 'integer', bits: 8 } },
      3,
    );
    expect(file.length % 2).toBe(0);
    expect(view(file).getUint32(4, true)).toBe(file.length - 8);
    expect(reader.format.frames).toBe(3);
  });

  it('writes BW64 with its ds64 chunk at any length', async () => {
    const { file, reader } = await roundTrip(StandardLayouts.stereo, { form: 'bw64' });
    expect(text(file.subarray(0, 4))).toBe('BW64');
    expect(text(file.subarray(12, 16))).toBe('ds64');
    expect(reader.format.container).toBe('bw64');
  });

  it('writes the same bytes for the same samples and settings', async () => {
    const first = await roundTrip(
      StandardLayouts.surround5_1,
      { sampleFormat: { kind: 'ms-adpcm' } },
      3_000,
    );
    const second = await roundTrip(
      StandardLayouts.surround5_1,
      { sampleFormat: { kind: 'ms-adpcm' } },
      3_000,
    );
    expect(first.file).toEqual(second.file);
  });
});

describe('the switch to RF64', () => {
  /** A file that is the head, then zeros, never held. */
  const virtual = (head: Uint8Array, size: number): AudioBytes => ({
    size,
    read: async (offset, length) => {
      await Promise.resolve();
      const out = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
      out.set(head.subarray(offset, Math.min(head.length, offset + out.length)));
      return out;
    },
  });
  const parts = (dataLength: number): WaveHeadParts => ({
    form: 'riff',
    format: waveFormatChunk({
      encoding: { kind: 'integer', bits: 16, bytes: 2, byteOrder: 'little', signed: true },
      channelCount: 1,
      sampleRate: 48_000,
      blockAlign: 2,
      framesPerBlock: 1,
      form: { kind: 'plain' },
    }),
    factFrames: undefined,
    chunks: [{ id: 'LIST', body: new Uint8Array(13) }],
    dataLength,
    frames: dataLength / 2,
  });

  it('stays RIFF while the form’s size fits short of the marker, and becomes RF64 a frame past it', async () => {
    // The head is 12 + 24 + 22 + 8 bytes, so the form's size is 58 bytes past the data's.
    const last = 0xfffffffe - 58;
    const plain = expectSuccess(
      waveHeadPlan(parts(last), () => {
        throw new Error('unreachable');
      }),
    );
    expect(plain.container).toBe('wav');
    const large = expectSuccess(
      waveHeadPlan(parts(last + 2), () => {
        throw new Error('unreachable');
      }),
    );
    expect(large.container).toBe('rf64');
    const head = writeWaveHead(large, parts(last + 2));
    const reader = expectSuccess(await openAudio(virtual(head, large.fileLength)));
    expect(reader.format).toMatchObject({ container: 'rf64', frames: (last + 2) / 2 });
  });
});

describe('the metadata of a WAV export', () => {
  it('writes the parts WAV holds, which read back, and names the rest as dropped', async () => {
    const metadata = {
      text: { title: 'Rain on tin', artist: 'Field kit', albumArtist: 'Nobody' },
      cues: [{ position: 100 as SampleCount, name: 'Thunder' }],
      loops: [
        {
          start: 200 as SampleCount,
          length: 300 as SampleCount,
          playCount: 'endless' as const,
          direction: 'forward' as const,
        },
      ],
      foreign: [{ scheme: 'riff', key: 'iXML', value: '<BWFXML/>' }],
      coverArt: { mediaType: 'image/png', description: '', bytes: new Uint8Array(4) },
    };
    const { file, finished } = await roundTrip(StandardLayouts.stereo, { metadata });
    expect(finished.dropped).toEqual(
      expect.arrayContaining([
        { kind: 'text', key: 'albumArtist' },
        { kind: 'coverArt' },
        { kind: 'foreign', scheme: 'riff', key: 'iXML' },
      ]),
    );
    const read = expectSuccess(await readRiffMetadata(memoryBytes(file)));
    expect(read.text).toMatchObject({ title: 'Rain on tin', artist: 'Field kit' });
    expect(read.cues).toEqual([{ position: 100, name: 'Thunder' }]);
    expect(read.loops).toMatchObject([
      { start: 200, length: 300, playCount: 'endless', direction: 'forward' },
    ]);
  });
});

describe('the WAV writer’s contract', () => {
  it('refuses a block of the wrong channels or frames, and ends', async () => {
    const opened = expectSuccess(createWavWriter(settings(StandardLayouts.stereo)));
    expect(expectFailureCode(await opened.writer.write([new Float32Array(4)], 4))).toBe(
      'codecs.write-invalid',
    );
    expect(
      expectFailureCode(await opened.writer.write([new Float32Array(4), new Float32Array(4)], 4)),
    ).toBe('codecs.write-invalid');
    expect(expectFailureCode(await opened.writer.finish())).toBe('codecs.write-invalid');
  });

  it('refuses frames it was not handed, and a write after the end', async () => {
    const opened = expectSuccess(createWavWriter(settings(StandardLayouts.mono)));
    expect(expectFailureCode(await opened.writer.write([new Float32Array(2)], 3))).toBe(
      'codecs.write-invalid',
    );
    const other = expectSuccess(createWavWriter(settings(StandardLayouts.mono)));
    expectSuccess(await other.writer.finish());
    expect(expectFailureCode(await other.writer.write([new Float32Array(2)], 2))).toBe(
      'codecs.write-invalid',
    );
  });

  it('takes 64-bit planes: a 32-bit integer exactly, and a 32-bit float rounded to the nearest', async () => {
    // Each of these integers is k / 2^31 exactly in a 64-bit float and in no 32-bit one but the ends.
    const integers = [2 ** 31 - 1, -(2 ** 31), 123_456_789, -987_654_321];
    const integer = expectSuccess(
      createWavWriter(
        settings(StandardLayouts.mono, { sampleFormat: { kind: 'integer', bits: 32 } }),
      ),
    );
    const { file: integerFile } = await writeWhole(integer.writer, [
      Float64Array.from(integers, (value) => value / 2 ** 31),
    ]);
    const integerData = (chunkAt(integerFile, 'data') ?? 0) + 8;
    expect(
      integers.map((_, index) => view(integerFile).getInt32(integerData + index * 4, true)),
    ).toEqual(integers);

    const wide = [0.1, -1 / 3, 2 ** -30 + 2 ** -60];
    const float = expectSuccess(
      createWavWriter(
        settings(StandardLayouts.mono, { sampleFormat: { kind: 'float', bits: 32 } }),
      ),
    );
    const { file: floatFile } = await writeWhole(float.writer, [Float64Array.from(wide)]);
    const floatData = (chunkAt(floatFile, 'data') ?? 0) + 8;
    expect(wide.map((_, index) => view(floatFile).getFloat32(floatData + index * 4, true))).toEqual(
      wide.map(Math.fround),
    );
  });

  it('rejects with the signal’s reason when cancelled', async () => {
    const opened = expectSuccess(createWavWriter(settings(StandardLayouts.mono)));
    const controller = new AbortController();
    const reason = new Error('The export was cancelled.');
    controller.abort(reason);
    await expect(opened.writer.write([new Float32Array(2)], 2, controller.signal)).rejects.toBe(
      reason,
    );
    await expect(opened.writer.finish(controller.signal)).rejects.toBe(reason);
  });
});
