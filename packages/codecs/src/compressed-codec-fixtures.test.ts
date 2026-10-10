/**
 * The compressed codes read in place (ADR-0090): G.711 A-law and µ-law, IMA
 * ADPCM in WAV and AIFF-C `ima4`, and Microsoft ADPCM, written by the fixture
 * writers as random coded bytes, opened, and checked sample for sample.
 *
 * The expected samples come from decoders written here from the standards'
 * own descriptions, apart from the package's: G.711's segment and step
 * formulas of ITU-T G.711, checked against values its tables give, and the
 * ADPCM decoders of the IMA's recommended practice and Microsoft's
 * specification, each reading its block layout itself. Any 4-bit code is a
 * valid ADPCM sample, so random blocks drive every step and clamp a decoder
 * has, which a signal written by an encoder would visit only in part.
 */

import type { SampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { openAudio, type AudioReader } from './index.js';
import { recogniseAudio } from './recognition.js';
import { memoryBytes, writeAiff, writeCompressedWav } from './testing/index.js';

/** A deterministic generator of 32-bit fractions. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Random bytes. */
function randomBytes(length: number, next: () => number): Uint8Array {
  return Uint8Array.from({ length }, () => Math.floor(next() * 256));
}

/** G.711 A-law by ITU-T G.711: even bits inverted, sign set for positive, 13-bit magnitude. */
function referenceAlaw(byte: number): number {
  const code = byte ^ 0x55;
  const segment = (code >> 4) & 7;
  const step = code & 15;
  const magnitude = segment === 0 ? 2 * step + 1 : (2 * step + 33) * 2 ** (segment - 1);
  return ((code & 0x80) === 0 ? -1 : 1) * magnitude * 8;
}

/** G.711 µ-law by ITU-T G.711: all bits inverted, sign set for negative, 14-bit magnitude. */
function referenceUlaw(byte: number): number {
  const code = ~byte & 0xff;
  const segment = (code >> 4) & 7;
  const step = code & 15;
  const magnitude = (2 * step + 33) * 2 ** segment - 33;
  return ((code & 0x80) === 0 ? 1 : -1) * magnitude * 4;
}

/** The IMA step table of the recommended practice. */
const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_STEPS = [-1, -1, -1, -1, 2, 4, 6, 8];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The IMA decoder of the recommended practice, over a channel's nibbles from a starting state. */
function referenceIma(predictor: number, index: number, nibbles: readonly number[]): number[] {
  const out: number[] = [];
  let sample = predictor;
  let at = index;
  for (const nibble of nibbles) {
    const step = STEPS[at] ?? Number.NaN;
    let difference = step >> 3;
    if (nibble & 4) difference += step;
    if (nibble & 2) difference += step >> 1;
    if (nibble & 1) difference += step >> 2;
    sample = clamp(nibble & 8 ? sample - difference : sample + difference, -32768, 32767);
    at = clamp(at + (INDEX_STEPS[nibble & 7] ?? Number.NaN), 0, 88);
    out.push(sample);
  }
  return out;
}

/** A WAV IMA file's samples, block by block, channel by channel, read from its layout. */
function referenceImaWav(
  data: Uint8Array,
  channels: number,
  blockAlign: number,
  framesPerBlock: number,
  frames: number,
): number[][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: number[][] = Array.from({ length: channels }, () => []);
  for (let block = 0; block * framesPerBlock < frames; block += 1) {
    const base = block * blockAlign;
    for (let channel = 0; channel < channels; channel += 1) {
      const predictor = view.getInt16(base + 4 * channel, true);
      const index = view.getUint8(base + 4 * channel + 2);
      const nibbles: number[] = [];
      for (let sample = 0; sample < framesPerBlock - 1; sample += 1) {
        const word = Math.floor(sample / 8);
        const byte =
          data[
            base + 4 * channels + word * 4 * channels + 4 * channel + Math.floor((sample % 8) / 2)
          ] ?? 0;
        nibbles.push(sample % 2 === 0 ? byte & 15 : byte >> 4);
      }
      out[channel]!.push(predictor, ...referenceIma(predictor, index, nibbles));
    }
  }
  return out.map((channel) => channel.slice(0, frames));
}

/** An AIFF-C `ima4` file's samples, packet by packet, from Apple's packet layout. */
function referenceIma4(data: Uint8Array, channels: number, packets: number): number[][] {
  const out: number[][] = Array.from({ length: channels }, () => []);
  for (let packet = 0; packet < packets; packet += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const base = (packet * channels + channel) * 34;
      const header = ((data[base] ?? 0) << 8) | (data[base + 1] ?? 0);
      const predictor = header & 0x8000 ? (header & 0xff80) - 0x10000 : header & 0xff80;
      const nibbles = Array.from({ length: 64 }, (_, sample) => {
        const byte = data[base + 2 + Math.floor(sample / 2)] ?? 0;
        return sample % 2 === 0 ? byte & 15 : byte >> 4;
      });
      out[channel]!.push(...referenceIma(predictor, header & 0x7f, nibbles));
    }
  }
  return out;
}

const MS_ADAPTATION = [
  230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230,
];
const MS_STANDARD: readonly (readonly [number, number])[] = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232],
];

/** A Microsoft ADPCM file's samples, by the specification's decoder and block layout. */
function referenceMs(
  data: Uint8Array,
  channels: number,
  blockAlign: number,
  framesPerBlock: number,
  frames: number,
  coefficients: readonly (readonly [number, number])[],
): number[][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: number[][] = Array.from({ length: channels }, () => []);
  for (let block = 0; block * framesPerBlock < frames; block += 1) {
    const base = block * blockAlign;
    const state = Array.from({ length: channels }, (_, channel) => {
      const [first, second] = coefficients[view.getUint8(base + channel)] ?? [
        Number.NaN,
        Number.NaN,
      ];
      return {
        first,
        second,
        delta: view.getInt16(base + channels + 2 * channel, true),
        sample1: view.getInt16(base + 3 * channels + 2 * channel, true),
        sample2: view.getInt16(base + 5 * channels + 2 * channel, true),
      };
    });
    state.forEach((channel, index) => out[index]!.push(channel.sample2, channel.sample1));
    for (let nibbleIndex = 0; nibbleIndex < (framesPerBlock - 2) * channels; nibbleIndex += 1) {
      const byte = data[base + 7 * channels + Math.floor(nibbleIndex / 2)] ?? 0;
      const nibble = nibbleIndex % 2 === 0 ? byte >> 4 : byte & 15;
      const channel = state[nibbleIndex % channels]!;
      const predicted = Math.trunc(
        (channel.sample1 * channel.first + channel.sample2 * channel.second) / 256,
      );
      const sample = clamp(
        predicted + (nibble >= 8 ? nibble - 16 : nibble) * channel.delta,
        -32768,
        32767,
      );
      channel.sample2 = channel.sample1;
      channel.sample1 = sample;
      channel.delta = Math.max(16, Math.floor((MS_ADAPTATION[nibble]! * channel.delta) / 256));
      out[nibbleIndex % channels]!.push(sample);
    }
  }
  return out.map((channel) => channel.slice(0, frames));
}

/** Reads every frame from `start` for `frames`, and checks each sample against `expected / 2^15`. */
async function expectSamples(
  reader: AudioReader,
  expected: readonly (readonly number[])[],
  start: number,
  frames: number,
): Promise<void> {
  const into = expected.map(() => new Float32Array(frames));
  const read = expectSuccess(await reader.read(start as SampleCount, frames, into));
  const available = Math.max(0, Math.min(frames, (expected[0]?.length ?? 0) - start));
  expect(read).toBe(available);
  for (const [channel, samples] of into.entries()) {
    const wanted = Float32Array.from(
      (expected[channel] ?? []).slice(start, start + read),
      (value) => value / 32768,
    );
    const first = Array.from(samples.subarray(0, read)).findIndex(
      (value, index) => value !== wanted[index],
    );
    expect(first === -1 ? undefined : { channel, frame: start + first }).toBeUndefined();
  }
}

/** Reads a file whole and from starts and lengths that cross blocks and end at the last frame. */
async function expectEveryRead(
  file: Uint8Array,
  expected: readonly (readonly number[])[],
): Promise<AudioReader> {
  const reader = expectSuccess(await openAudio(memoryBytes(file)));
  const frames = expected[0]?.length ?? 0;
  await expectSamples(reader, expected, 0, frames);
  for (const [start, length] of [
    [1, 7],
    [63, 3],
    [64, 65],
    [frames - 1, 1],
    [frames - 5, 20],
    [Math.floor(frames / 3), Math.floor(frames / 2)],
    [frames, 3],
  ] as const) {
    await expectSamples(reader, expected, start, length);
  }
  return reader;
}

describe('G.711 decoded by the reference', () => {
  it('gives the values ITU-T G.711 tabulates at the ends of each law', () => {
    // A-law: 0xD5 and 0x55 are the smallest steps either side of zero, 0xAA and 0x2A full scale.
    expect([0xd5, 0x55, 0xaa, 0x2a].map(referenceAlaw)).toEqual([8, -8, 32256, -32256]);
    // µ-law: 0xFF and 0x7F are the two zeros, 0x80 and 0x00 full scale.
    expect([0xff, 0x7f, 0x80, 0x00].map(referenceUlaw)).toEqual([0, -0, 32124, -32124]);
  });
});

describe.each([
  { name: 'A-law', kind: 'g711-alaw', reference: referenceAlaw, aifc: ['alaw', 'ALAW'] },
  { name: 'µ-law', kind: 'g711-ulaw', reference: referenceUlaw, aifc: ['ulaw', 'ULAW'] },
] as const)('$name', ({ kind, reference, aifc }) => {
  const every = Uint8Array.from({ length: 256 }, (_, byte) => byte);

  it('reads every code of a WAV, RF64 and BW64 file at any rate and channel count', async () => {
    let seed = 3;
    for (const form of ['wav', 'rf64', 'bw64'] as const) {
      for (const [rate, channels] of [
        [8_000, 1],
        [44_100, 2],
        [96_000, 6],
      ] as const) {
        seed += 1;
        const data = channels === 1 ? every : randomBytes(channels * 300, random(seed));
        const file = writeCompressedWav({
          form,
          sampleRate: rate,
          channelCount: channels,
          coding: { kind },
          data,
          factFrames: data.length / channels,
        });
        expect(expectSuccess(await recogniseAudio(memoryBytes(file)))).toEqual({
          kind: 'audio',
          container: form,
          codec: { kind: 'named', codec: kind },
        });
        const expected = Array.from({ length: channels }, (_, channel) =>
          Array.from(
            data.filter((_, at) => at % channels === channel),
            reference,
          ),
        );
        const reader = await expectEveryRead(file, expected);
        expect(reader.format).toMatchObject({
          container: form,
          sampleRate: rate,
          encoding: { kind },
          channelCount: channels,
          frames: data.length / channels,
          blockAlign: channels,
        });
      }
    }
  });

  it.each(aifc)('reads every code of an AIFF-C file of type %j', async (type) => {
    const data = randomBytes(2 * 200, random(17));
    const file = writeAiff({
      form: 'aifc',
      compressionType: type,
      sampleSize: 16,
      sampleRate: 22_050,
      channels: [new Float64Array(200), new Float64Array(200)],
      encodedSamples: data,
    });
    const expected = [0, 1].map((channel) =>
      Array.from(
        data.filter((_, at) => at % 2 === channel),
        reference,
      ),
    );
    const reader = await expectEveryRead(file, expected);
    expect(reader.format).toMatchObject({ container: 'aifc', encoding: { kind }, blockAlign: 2 });
    const single = writeAiff({
      form: 'aifc',
      compressionType: type,
      sampleSize: 8,
      sampleRate: 8_000,
      channels: [new Float64Array(256)],
      encodedSamples: every,
    });
    await expectEveryRead(single, [Array.from(every, reference)]);
  });
});

/** IMA blocks of random nibbles behind headers of random first samples and step indices. */
function imaBlocks(
  blocks: number,
  channels: number,
  blockAlign: number,
  next: () => number,
): Uint8Array {
  const data = randomBytes(blocks * blockAlign, next);
  for (let block = 0; block < blocks; block += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      data[block * blockAlign + 4 * channel + 2] = Math.floor(next() * 89);
    }
  }
  return data;
}

describe('IMA ADPCM in WAV', () => {
  it.each([
    { channels: 1, blockAlign: 256, framesPerBlock: 505, blocks: 5, frames: 2_400 },
    { channels: 2, blockAlign: 1_024, framesPerBlock: 1_017, blocks: 3, frames: 3_051 },
    // Fewer samples per block than the block holds, which the format allows.
    { channels: 6, blockAlign: 6 * 4 * 5, framesPerBlock: 30, blocks: 7, frames: 200 },
  ])(
    'reads $channels channels in $blockAlign-byte blocks to the frame the fact chunk states',
    async ({ channels, blockAlign, framesPerBlock, blocks, frames }) => {
      const data = imaBlocks(blocks, channels, blockAlign, random(channels));
      const file = writeCompressedWav({
        sampleRate: 32_000,
        channelCount: channels,
        coding: { kind: 'ima-adpcm', blockAlign, framesPerBlock },
        data,
        factFrames: frames,
      });
      const expected = referenceImaWav(data, channels, blockAlign, framesPerBlock, frames);
      const reader = await expectEveryRead(file, expected);
      expect(reader.format).toMatchObject({
        encoding: { kind: 'ima-adpcm', packing: 'wav', framesPerBlock },
        frames,
        declaredFrames: frames,
        blockAlign,
      });
    },
  );

  it('reads a file with no fact chunk as every frame its blocks hold', async () => {
    const data = imaBlocks(4, 2, 512, random(5));
    const file = writeCompressedWav({
      sampleRate: 48_000,
      channelCount: 2,
      coding: { kind: 'ima-adpcm', blockAlign: 512, framesPerBlock: 505 },
      data,
    });
    const reader = await expectEveryRead(file, referenceImaWav(data, 2, 512, 505, 4 * 505));
    expect(reader.format.frames).toBe(4 * 505);
  });

  it('reads a file cut inside a block to the last frame every channel of it holds', async () => {
    const data = imaBlocks(3, 2, 256, random(8));
    const file = writeCompressedWav({
      sampleRate: 48_000,
      channelCount: 2,
      coding: { kind: 'ima-adpcm', blockAlign: 256, framesPerBlock: 249 },
      data,
      factFrames: 3 * 249,
      // The last block keeps its header and two whole 8-frame groups of both channels, and 3 bytes more.
      truncate: 256 - (8 + 2 * 8 + 3),
    });
    const reader = await expectEveryRead(
      file,
      referenceImaWav(data, 2, 256, 249, 2 * 249 + 1 + 2 * 8),
    );
    expect(reader.format.declaredFrames).toBe(3 * 249);
  });
});

describe('IMA ADPCM in AIFF-C ima4', () => {
  it.each([1, 2, 3])('reads %i channels of 64-frame packets', async (channels) => {
    const packets = 9;
    const data = randomBytes(packets * channels * 34, random(channels + 40));
    for (let packet = 0; packet < packets * channels; packet += 1) {
      // A step index of 0 to 88 in the header's low seven bits.
      data[packet * 34 + 1] =
        ((data[packet * 34 + 1] ?? 0) & 0x80) | Math.floor((data[packet * 34] ?? 0) / 3);
    }
    const file = writeAiff({
      form: 'aifc',
      compressionType: 'ima4',
      sampleSize: 16,
      sampleRate: 44_100,
      channels: Array.from({ length: channels }, () => new Float64Array(0)),
      commonOverrides: { declaredFrames: packets },
      encodedSamples: data,
    });
    const reader = await expectEveryRead(file, referenceIma4(data, channels, packets));
    expect(reader.format).toMatchObject({
      container: 'aifc',
      encoding: { kind: 'ima-adpcm', packing: 'ima4', framesPerBlock: 64 },
      frames: packets * 64,
      blockAlign: 34 * channels,
    });
  });

  it('reads a file cut inside a packet to the last whole packet', async () => {
    const data = randomBytes(4 * 2 * 34, random(77)).map((byte, at) =>
      at % 34 === 1 ? byte & 0x80 : byte,
    );
    const file = writeAiff({
      form: 'aifc',
      compressionType: 'ima4',
      sampleSize: 16,
      sampleRate: 44_100,
      channels: [new Float64Array(0), new Float64Array(0)],
      commonOverrides: { declaredFrames: 4 },
      encodedSamples: data,
      truncate: 40,
    });
    const reader = await expectEveryRead(file, referenceIma4(data, 2, 3));
    expect(reader.format).toMatchObject({ frames: 3 * 64, declaredFrames: 4 * 64 });
  });
});

/** Microsoft ADPCM blocks of random nibbles behind headers choosing a pair from `pairs`. */
function msBlocks(
  blocks: number,
  channels: number,
  blockAlign: number,
  pairs: number,
  next: () => number,
): Uint8Array {
  const data = randomBytes(blocks * blockAlign, next);
  const view = new DataView(data.buffer);
  for (let block = 0; block < blocks; block += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      data[block * blockAlign + channel] = Math.floor(next() * pairs);
      view.setInt16(
        block * blockAlign + channels + 2 * channel,
        16 + Math.floor(next() * 2_000),
        true,
      );
    }
  }
  return data;
}

describe('Microsoft ADPCM in WAV', () => {
  const custom = [...MS_STANDARD, [128, 64], [-256, 512]] as const;

  it.each([
    { channels: 1, blockAlign: 256, framesPerBlock: 500, frames: 1_900, coefficients: MS_STANDARD },
    { channels: 2, blockAlign: 512, framesPerBlock: 500, frames: 2_000, coefficients: MS_STANDARD },
    { channels: 5, blockAlign: 5 * 7 + 50, framesPerBlock: 22, frames: 140, coefficients: custom },
  ])(
    'reads $channels channels in $blockAlign-byte blocks, with the format chunk’s coefficients',
    async ({ channels, blockAlign, framesPerBlock, frames, coefficients }) => {
      const blocks = Math.ceil(frames / framesPerBlock);
      const data = msBlocks(
        blocks,
        channels,
        blockAlign,
        coefficients.length,
        random(channels * 9),
      );
      const file = writeCompressedWav({
        sampleRate: 22_050,
        channelCount: channels,
        coding: { kind: 'ms-adpcm', blockAlign, framesPerBlock, coefficients },
        data,
        factFrames: frames,
      });
      const expected = referenceMs(
        data,
        channels,
        blockAlign,
        framesPerBlock,
        frames,
        coefficients,
      );
      const reader = await expectEveryRead(file, expected);
      expect(reader.format).toMatchObject({
        encoding: { kind: 'ms-adpcm', framesPerBlock, coefficients },
        frames,
        blockAlign,
      });
    },
  );

  it('reads a file cut inside a block to the last frame every channel of it holds', async () => {
    const data = msBlocks(2, 2, 512, 7, random(31));
    const file = writeCompressedWav({
      sampleRate: 22_050,
      channelCount: 2,
      coding: { kind: 'ms-adpcm', blockAlign: 512, framesPerBlock: 500, coefficients: MS_STANDARD },
      data,
      factFrames: 1_000,
      // The second block keeps its header and three bytes past it: three whole stereo frames.
      truncate: 512 - (14 + 3),
    });
    await expectEveryRead(file, referenceMs(data, 2, 512, 500, 500 + 2 + 3, MS_STANDARD));
  });
});

describe('reading ADPCM in bounded pieces', () => {
  it('asks only for the blocks that hold the frames read, in pieces of at most 1 MiB', async () => {
    const blockAlign = 2_048;
    const framesPerBlock = 2_041;
    const blocks = 700;
    const data = imaBlocks(blocks, 2, blockAlign, random(91));
    const file = writeCompressedWav({
      sampleRate: 48_000,
      channelCount: 2,
      coding: { kind: 'ima-adpcm', blockAlign, framesPerBlock },
      data,
    });
    const bytes = memoryBytes(file);
    const reader = expectSuccess(await openAudio(bytes));
    const before = bytes.requests.length;
    const start = 10 * framesPerBlock + 1_000;
    const length = 600 * framesPerBlock;
    const into = [new Float32Array(length), new Float32Array(length)];
    expect(expectSuccess(await reader.read(start as SampleCount, length, into))).toBe(length);
    const reads = bytes.requests.slice(before);
    expect(reads[0]?.offset).toBe(reader.format.dataOffset + 10 * blockAlign);
    expect(Math.max(...reads.map((read) => read.length))).toBeLessThanOrEqual(1 << 20);
    // The blocks from the start's to the end's, the last only as far as its last frame read.
    const lastFrame = (start + length - 1) % framesPerBlock;
    const lastBytes = 8 + Math.ceil(lastFrame / 8) * 8;
    expect(reads.reduce((total, read) => total + read.length, 0)).toBe(
      600 * blockAlign + lastBytes,
    );
    const expected = referenceImaWav(data, 2, blockAlign, framesPerBlock, start + length);
    for (const [channel, samples] of into.entries()) {
      expect(samples[0]).toBe((expected[channel]![start] ?? Number.NaN) / 32768);
      expect(samples[length - 1]).toBe(
        (expected[channel]![start + length - 1] ?? Number.NaN) / 32768,
      );
    }
  });
});
