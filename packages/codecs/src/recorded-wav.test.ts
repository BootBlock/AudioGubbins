/**
 * The recorded-media writer against the read contract (ADR-0071): every header
 * it writes is opened by `openAudio`, which must find the rate, the layout and
 * the length it was given, and read the samples written after it bit for bit.
 *
 * The switch to RF64 is tested at its boundary over bytes that are never held:
 * a source the size of a four-gibibyte file that answers the header from the
 * writer and each sample from a formula of its position.
 */

import {
  ChannelRole,
  StandardLayouts,
  ambisonicLayout,
  discreteLayout,
  labelledLayout,
  sampleCount,
  sampleRate,
  type ChannelLayout,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import type { AudioBytes } from './audio-bytes.js';
import { openAudio } from './index.js';
import { recordedWavHeader, recordedWavLength, type RecordedWavFormat } from './recorded-wav.js';
import { memoryBytes } from './testing/index.js';

const RATE = expectSuccess(sampleRate(48_000));

const frames = (count: number): SampleCount => expectSuccess(sampleCount(count));

const formatOf = (layout: ChannelLayout): RecordedWavFormat => ({ sampleRate: RATE, layout });

/**
 * Samples whose bits a converter that touched them would change: both zeros,
 * the smallest subnormal, the largest finite value, values past full scale
 * and a deterministic spread of fractions.
 */
function samples(count: number, seed: number): Float32Array {
  const special = [0, -0, 2 ** -149, -(2 ** -149), 3.4028234663852886e38, 1.5, -2, 1 / 3];
  const out = new Float32Array(count);
  let state = seed >>> 0;
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    out[index] = special[index] ?? state / 2 ** 31 - 1;
  }
  return out;
}

/** The interleaved little-endian bytes of `channels`, as the recording's chunks hold them. */
function interleaved(channels: readonly Float32Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length * channels.length * 4);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < length; frame += 1) {
    channels.forEach((channel, index) => {
      view.setFloat32((frame * channels.length + index) * 4, channel[frame] ?? Number.NaN, true);
    });
  }
  return bytes;
}

/** The bits of each sample, so a comparison cannot equate `0` with `-0`. */
const bitsOf = (channel: Float32Array): readonly number[] =>
  Array.from(new Uint32Array(channel.buffer, channel.byteOffset, channel.length));

/** Writes a recording of `channels` in `layout` and opens it with the read contract. */
async function roundTrip(layout: ChannelLayout, channels: readonly Float32Array[]) {
  const length = channels[0]?.length ?? 0;
  const header = expectSuccess(recordedWavHeader(formatOf(layout), frames(length)));
  const data = interleaved(channels, length);
  const file = new Uint8Array(header.bytes.length + data.length);
  file.set(header.bytes);
  file.set(data, header.dataOffset);
  const reader = expectSuccess(await openAudio(memoryBytes(file)));
  const into = channels.map(() => new Float32Array(length));
  const read = expectSuccess(await reader.read(frames(0), length, into));
  return { header, file, reader, into, read };
}

const SURROUND_5_1: ChannelLayout = StandardLayouts.surround5_1;

describe('recordedWavHeader', () => {
  const cases: readonly { name: string; layout: ChannelLayout; container: string }[] = [
    { name: 'mono', layout: StandardLayouts.mono, container: 'plain' },
    { name: 'stereo', layout: StandardLayouts.stereo, container: 'plain' },
    { name: '5.1', layout: SURROUND_5_1, container: 'extensible' },
    { name: 'quadraphonic', layout: StandardLayouts.quadraphonic, container: 'extensible' },
    { name: 'four discrete', layout: expectSuccess(discreteLayout(4)), container: 'extensible' },
    {
      name: 'stereo with two discrete',
      layout: {
        roles: [ChannelRole.Left, ChannelRole.Right, ChannelRole.Discrete, ChannelRole.Discrete],
      },
      container: 'extensible',
    },
  ];

  for (const { name, layout, container } of cases) {
    it(`writes a ${name} recording the reader gives back bit for bit, in its layout`, async () => {
      const length = 300;
      const channels = layout.roles.map((_, index) => samples(length, index + 1));
      const { header, file, reader, into, read } = await roundTrip(layout, channels);

      expect(read).toBe(length);
      into.forEach((channel, index) => {
        expect(bitsOf(channel)).toEqual(bitsOf(channels[index] ?? new Float32Array()));
      });
      expect(reader.format).toMatchObject({
        container: 'wav',
        sampleRate: 48_000,
        encoding: { kind: 'float', bits: 32, bytes: 4, byteOrder: 'little' },
        channelCount: layout.roles.length,
        layout,
        frames: length,
        declaredFrames: length,
        dataOffset: header.dataOffset,
        blockAlign: layout.roles.length * 4,
      });
      expect(header).toMatchObject({
        container: 'wav',
        dataLength: length * layout.roles.length * 4,
        fileLength: file.length,
      });
      // The format tag: 3 is plain IEEE float, 0xFFFE the extensible form.
      const tag = new DataView(header.bytes.buffer).getUint16(20, true);
      expect(tag).toBe(container === 'plain' ? 3 : 0xfffe);
    });
  }

  it('states a speaker layout in the header, so the reader finds it stated', async () => {
    const { reader } = await roundTrip(
      SURROUND_5_1,
      SURROUND_5_1.roles.map(() => samples(4, 9)),
    );
    expect(reader.format.statedLayout).toEqual(SURROUND_5_1);
  });

  it('writes a recording of no frames that opens with none', async () => {
    const { reader, read } = await roundTrip(StandardLayouts.stereo, [
      new Float32Array(),
      new Float32Array(),
    ]);
    expect(reader.format.frames).toBe(0);
    expect(read).toBe(0);
  });

  it('writes the fact chunk with the frames, as a WAV of float samples must have', () => {
    const header = expectSuccess(recordedWavHeader(formatOf(StandardLayouts.mono), frames(1_234)));
    const view = new DataView(header.bytes.buffer);
    // RIFF header (12), then the 18-byte plain format chunk (26), then fact.
    expect(String.fromCharCode(...header.bytes.subarray(38, 42))).toBe('fact');
    expect(view.getUint32(46, true)).toBe(1_234);
    expect(header.dataOffset).toBe(58);
  });

  const refused: readonly { name: string; layout: ChannelLayout }[] = [
    { name: 'a labelled layout', layout: expectSuccess(labelledLayout(['Kick', 'Snare'])) },
    {
      name: 'an ambisonic layout',
      layout: expectSuccess(ambisonicLayout({ order: 1, ordering: 'acn', normalisation: 'sn3d' })),
    },
    { name: 'one discrete channel', layout: expectSuccess(discreteLayout(1)) },
    { name: 'two discrete channels', layout: expectSuccess(discreteLayout(2)) },
    {
      name: 'speakers out of mask order',
      layout: { roles: [ChannelRole.Right, ChannelRole.Left] },
    },
    {
      // A mask places its speakers in bit order, which puts the rear pair before the side pair.
      name: 'the side pair before the rear pair, as 7.1 is held',
      layout: StandardLayouts.surround7_1,
    },
    { name: 'the centre alone, which reads as mono', layout: { roles: [ChannelRole.Centre] } },
    {
      name: 'a discrete channel before a speaker',
      layout: { roles: [ChannelRole.Discrete, ChannelRole.Left, ChannelRole.Right] },
    },
  ];

  for (const { name, layout } of refused) {
    it(`refuses ${name}, which would be read back as another layout`, () => {
      expect(expectFailureCode(recordedWavHeader(formatOf(layout), frames(10)))).toBe(
        'codecs.layout-unwritable',
      );
      expect(expectFailureCode(recordedWavLength(formatOf(layout), frames(0)))).toBe(
        'codecs.layout-unwritable',
      );
    });
  }

  it('refuses a length whose byte offsets cannot be exact', () => {
    const longest = frames(Number.MAX_SAFE_INTEGER);
    expect(expectFailureCode(recordedWavLength(formatOf(SURROUND_5_1), longest))).toBe(
      'codecs.length-unwritable',
    );
  });
});

describe('recordedWavLength', () => {
  it('is the header and the samples, without writing the header', () => {
    for (const count of [0, 1, 4_800, 1_073_741_812]) {
      const format = formatOf(SURROUND_5_1);
      const length = expectSuccess(recordedWavLength(format, frames(count)));
      const header = expectSuccess(recordedWavHeader(format, frames(count)));
      expect(length).toBe(header.fileLength);
      expect(length).toBe(header.bytes.length + count * 6 * 4);
    }
  });
});

/** The sample a virtual file holds at `index`, counting every channel's samples in order. */
const virtualSample = (index: number): number => (index % 65_521) / 65_521 - 0.5;

/**
 * The bytes of a file of `fileLength` that are never held: the header where it
 * lies, and each sample after it from its position.
 */
function virtualFile(header: Uint8Array, fileLength: number): AudioBytes {
  return {
    size: fileLength,
    read: async (offset, length) => {
      await Promise.resolve();
      const out = new Uint8Array(Math.max(0, Math.min(length, fileLength - offset)));
      const sample = new DataView(new ArrayBuffer(4));
      for (let at = 0; at < out.length; at += 1) {
        const position = offset + at;
        if (position < header.length) {
          out[at] = header[position] ?? 0;
          continue;
        }
        const index = Math.floor((position - header.length) / 4);
        sample.setFloat32(0, virtualSample(index), true);
        out[at] = sample.getUint8((position - header.length) % 4);
      }
      return out;
    },
  };
}

/** Opens a virtual recording of `count` frames in `layout` and reads its last two frames. */
async function openVirtual(layout: ChannelLayout, count: number) {
  const header = expectSuccess(recordedWavHeader(formatOf(layout), frames(count)));
  const reader = expectSuccess(await openAudio(virtualFile(header.bytes, header.fileLength)));
  const into = layout.roles.map(() => new Float32Array(2));
  expect(expectSuccess(await reader.read(frames(count - 2), 2, into))).toBe(2);
  const channels = layout.roles.length;
  into.forEach((channel, index) => {
    const first = (count - 2) * channels + index;
    expect(Array.from(channel)).toEqual([
      Math.fround(virtualSample(first)),
      Math.fround(virtualSample(first + channels)),
    ]);
  });
  return { header, format: reader.format };
}

describe('the switch to RF64', () => {
  // A mono file's form size is its 50 bytes of header after the size field and
  // four bytes a frame, so 1,073,741,811 frames make it 0xFFFFFFFE, the largest
  // size the plain form states, and one frame more makes it 0x100000002.
  const LAST_PLAIN_MONO = 1_073_741_811;

  it('keeps the plain form while its size fits short of the RF64 marker', async () => {
    const { header, format } = await openVirtual(StandardLayouts.mono, LAST_PLAIN_MONO);
    expect(header.container).toBe('wav');
    expect(new DataView(header.bytes.buffer).getUint32(4, true)).toBe(0xfffffffe);
    expect(format).toMatchObject({ container: 'wav', frames: LAST_PLAIN_MONO });
  });

  it('writes RF64 with its sizes in the ds64 chunk one frame past it', async () => {
    const count = LAST_PLAIN_MONO + 1;
    const { header, format } = await openVirtual(StandardLayouts.mono, count);
    expect(header.container).toBe('rf64');
    expect(format).toMatchObject({
      container: 'rf64',
      frames: count,
      declaredFrames: count,
      dataOffset: header.dataOffset,
    });
    const view = new DataView(header.bytes.buffer);
    const sixtyFour = (at: number) =>
      view.getUint32(at, true) + view.getUint32(at + 4, true) * 2 ** 32;
    expect(String.fromCharCode(...header.bytes.subarray(0, 4))).toBe('RF64');
    expect(view.getUint32(4, true)).toBe(0xffffffff);
    expect(String.fromCharCode(...header.bytes.subarray(12, 16))).toBe('ds64');
    // The form's size, the data's and the frames, each 64 bits.
    expect(sixtyFour(20)).toBe(header.fileLength - 8);
    expect(sixtyFour(28)).toBe(count * 4);
    expect(sixtyFour(36)).toBe(count);
    expect(header.fileLength).toBe(94 + count * 4);
  });

  it('reads a multichannel RF64 recording past four gibibytes in its layout', async () => {
    const count = 200_000_000;
    const { header, format } = await openVirtual(SURROUND_5_1, count);
    expect(header.container).toBe('rf64');
    expect(header.dataLength).toBeGreaterThan(2 ** 32);
    expect(format).toMatchObject({ container: 'rf64', frames: count, layout: SURROUND_5_1 });
  });
});
