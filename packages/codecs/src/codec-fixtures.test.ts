/**
 * Every encoding, depth, byte order and form REQ-AUDIO-220 names, written by
 * the fixture writers, opened, and checked field by field and bit for bit.
 *
 * The expected samples are computed here from the integer codes the fixture was
 * written from, never by the reader's own converter, so a reader that read the
 * wrong byte order, dropped the wrong padding or scaled by the wrong power
 * fails on the sample where it does.
 */

import { ChannelRole, type ChannelLayout, type SampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { noise } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import {
  openAudio,
  recogniseAudio,
  type AudioReader,
  type ReadableContainer,
  type SampleEncoding,
} from './index.js';
import {
  channelLayoutBody,
  memoryBytes,
  writeAiff,
  writeWav,
  type FixtureChannel,
  type FixtureChunk,
  type WavEncoding,
} from './testing/index.js';

/** A deterministic generator of 32-bit fractions, so every run writes the same fixtures. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

const RATES: readonly number[] = [8_000, 11_025, 44_100, 48_000, 96_000, 192_000];
const FRAMES = 37;

/** Odd-sized chunks the reader must step over, before the samples and after them. */
const BEFORE: readonly FixtureChunk[] = [{ id: 'junk', body: Uint8Array.of(1, 2, 3) }];
const AFTER: readonly FixtureChunk[] = [{ id: 'LIST', body: Uint8Array.of(9, 8, 7, 6, 5) }];

/** A channel arrangement and what a header stating it, or stating nothing, means. */
interface LayoutCase {
  readonly count: number;
  readonly mask: number;
  readonly stated: ChannelLayout | undefined;
  readonly fallback: ChannelLayout;
}

const discrete = (count: number): ChannelLayout => ({
  roles: [ChannelRole.Discrete, ...Array.from({ length: count - 1 }, () => ChannelRole.Discrete)],
});

const LAYOUTS: readonly LayoutCase[] = [
  {
    count: 1,
    mask: 0x4,
    stated: { roles: [ChannelRole.Mono] },
    fallback: { roles: [ChannelRole.Mono] },
  },
  {
    count: 2,
    mask: 0x3,
    stated: { roles: [ChannelRole.Left, ChannelRole.Right] },
    fallback: { roles: [ChannelRole.Left, ChannelRole.Right] },
  },
  {
    count: 6,
    mask: 0x3f,
    stated: {
      roles: [
        ChannelRole.Left,
        ChannelRole.Right,
        ChannelRole.Centre,
        ChannelRole.LowFrequency,
        ChannelRole.RearLeft,
        ChannelRole.RearRight,
      ],
    },
    fallback: discrete(6),
  },
  { count: 3, mask: 0, stated: undefined, fallback: discrete(3) },
];

/** What a fixture is written from, and what reading it must give. */
interface ChannelPlan {
  readonly written: FixtureChannel;
  readonly expected: Float32Array;
}

/** Integer codes over the whole range, its extremes and the codes beside zero first. */
function integerChannel(bits: number, next: () => number): ChannelPlan {
  const half = 2 ** (bits - 1);
  const codes = [-half, half - 1, 0, -1, 1];
  while (codes.length < FRAMES) codes.push(Math.floor(next() * 2 * half) - half);
  return {
    written: Float64Array.from(codes, (code) => code / half),
    expected: Float32Array.from(codes, (code) => Math.fround(code / half)),
  };
}

/** Float32 samples from a noise fixture, with the values a careless copy would change. */
function float32Channel(seed: number): ChannelPlan {
  const samples = Float32Array.from(noise(seed, { length: FRAMES }).channels[0] ?? []);
  const bits = new Uint32Array(samples.buffer);
  // A quiet and a signalling NaN with payloads, negative zero, infinity, the least subnormal, the greatest finite.
  [0x7fc12345, 0x7f812345, 0x80000000, 0x7f800000, 0x00000001, 0x7f7fffff].forEach(
    (value, index) => {
      bits[index] = value;
    },
  );
  return { written: samples, expected: Float32Array.from(samples) };
}

/** Float64 samples, including ties, subnormals and values beyond float32's range. */
function float64Channel(next: () => number): ChannelPlan {
  const values = [1 + 2 ** -24, 1 + 3 * 2 ** -24, 1e-40, 1e-50, -0, Number.NaN, 1e39, -Infinity];
  while (values.length < FRAMES) values.push((next() * 2 - 1) * 1.5);
  return {
    written: Float64Array.from(values),
    expected: Float32Array.from(values, (value) => Math.fround(value)),
  };
}

/** A fixture form: how to write it and what its descriptor must say. */
interface FixtureCase {
  readonly name: string;
  readonly container: ReadableContainer;
  readonly encoding: SampleEncoding;
  readonly statesLayout: boolean;
  readonly write: (
    channels: readonly FixtureChannel[],
    rate: number,
    layout: LayoutCase,
  ) => Uint8Array;
}

const WAV_DEPTHS: readonly WavEncoding[] = [
  { kind: 'integer', bits: 8 },
  { kind: 'integer', bits: 16 },
  { kind: 'integer', bits: 20 },
  { kind: 'integer', bits: 24 },
  { kind: 'integer', bits: 24, bytes: 4 },
  { kind: 'integer', bits: 32 },
  { kind: 'float', bits: 32 },
  { kind: 'float', bits: 64 },
];

function wavCases(): FixtureCase[] {
  const cases: FixtureCase[] = [];
  for (const form of ['wav', 'rf64', 'bw64'] as const) {
    for (const extensible of [false, true]) {
      for (const depth of WAV_DEPTHS) {
        const bytes =
          depth.kind === 'float' ? depth.bits / 8 : (depth.bytes ?? Math.ceil(depth.bits / 8));
        if (!extensible && depth.kind === 'integer' && bytes !== Math.ceil(depth.bits / 8))
          continue;
        const encoding: SampleEncoding =
          depth.kind === 'float'
            ? {
                kind: 'float',
                bits: depth.bits,
                bytes: depth.bits === 32 ? 4 : 8,
                byteOrder: 'little',
              }
            : {
                kind: 'integer',
                bits: depth.bits,
                bytes,
                byteOrder: 'little',
                signed: bytes !== 1,
              };
        cases.push({
          name: `${form} ${extensible ? 'extensible' : 'plain'} ${depth.kind} ${String(depth.bits)} in ${String(bytes)}`,
          container: form,
          encoding,
          statesLayout: extensible,
          write: (channels, sampleRate, layout) =>
            writeWav({
              form,
              sampleRate,
              encoding: depth,
              channels,
              ...(extensible ? { extensible: { channelMask: layout.mask } } : {}),
              beforeData: BEFORE,
              afterData: AFTER,
            }),
        });
      }
    }
  }
  return cases;
}

/** Each AIFF-C type: its stated sample size, byte order, sign and kind. */
const AIFC_TYPES: readonly {
  type: string;
  bits: number;
  little: boolean;
  kind: 'integer' | 'float';
  signed: boolean;
}[] = [
  ...['NONE', 'twos', 'sowt'].flatMap((type) =>
    [8, 16, 20, 24, 32].map((bits) => ({
      type,
      bits,
      little: type === 'sowt',
      kind: 'integer' as const,
      signed: true,
    })),
  ),
  { type: 'in24', bits: 24, little: false, kind: 'integer', signed: true },
  { type: 'in32', bits: 32, little: false, kind: 'integer', signed: true },
  { type: '23ni', bits: 24, little: true, kind: 'integer', signed: true },
  { type: '42ni', bits: 32, little: true, kind: 'integer', signed: true },
  { type: 'raw ', bits: 8, little: false, kind: 'integer', signed: false },
  { type: 'fl32', bits: 32, little: false, kind: 'float', signed: true },
  { type: 'FL32', bits: 32, little: false, kind: 'float', signed: true },
  { type: 'fl64', bits: 64, little: false, kind: 'float', signed: true },
  { type: 'FL64', bits: 64, little: false, kind: 'float', signed: true },
];

function aiffCases(): FixtureCase[] {
  const plain = [8, 16, 20, 24, 32].map((bits) => ({
    form: 'aiff' as const,
    type: 'NONE',
    bits,
    little: false,
    kind: 'integer' as const,
    signed: true,
  }));
  const compressed = AIFC_TYPES.map((entry) => ({ form: 'aifc' as const, ...entry }));
  return [...plain, ...compressed].map((entry) => {
    const bytes = Math.ceil(entry.bits / 8);
    const byteOrder = entry.little ? 'little' : 'big';
    const encoding: SampleEncoding =
      entry.kind === 'float'
        ? {
            kind: 'float',
            bits: entry.bits === 32 ? 32 : 64,
            bytes: entry.bits === 32 ? 4 : 8,
            byteOrder,
          }
        : { kind: 'integer', bits: entry.bits, bytes, byteOrder, signed: entry.signed };
    return {
      name: `${entry.form} '${entry.type}' ${String(entry.bits)}`,
      container: entry.form,
      encoding,
      statesLayout: true,
      write: (channels: readonly FixtureChannel[], sampleRate: number, layout: LayoutCase) =>
        writeAiff({
          form: entry.form,
          compressionType: entry.type,
          sampleSize: entry.bits,
          sampleRate,
          channels,
          ...(layout.mask === 0
            ? {}
            : { channelLayout: channelLayoutBody({ tag: 1 << 16, bitmap: layout.mask }) }),
          soundOffset: 3,
          beforeSound: BEFORE,
          afterSound: AFTER,
        }),
    };
  });
}

/** The offset of the first sample, found by walking the file's chunks independently of the reader. */
function expectedDataOffset(file: Uint8Array, container: ReadableContainer): number {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const little = container === 'wav' || container === 'rf64' || container === 'bw64';
  const target = little ? 'data' : 'SSND';
  for (let at = 12; at + 8 <= file.length;) {
    const id = String.fromCharCode(...file.subarray(at, at + 4));
    const size = view.getUint32(at + 4, little);
    if (id === target) return little ? at + 8 : at + 16 + view.getUint32(at + 8, false);
    at += 8 + size + (size % 2);
  }
  throw new Error('The fixture has no sample data.');
}

/** The bits of each sample, so NaN payloads and signed zeros compare exactly. */
const bitsOf = (samples: Float32Array): Uint32Array =>
  new Uint32Array(samples.buffer, samples.byteOffset, samples.length);

/**
 * Checks two runs of samples bit for bit, naming the first that differs: a
 * whole-array diff of a long read would take longer to print than to fail.
 */
function expectSameBits(actual: Float32Array, expected: Float32Array): void {
  const actualBits = bitsOf(actual);
  const expectedBits = bitsOf(expected);
  expect(actualBits.length).toBe(expectedBits.length);
  const index = actualBits.findIndex((bits, at) => bits !== expectedBits[at]);
  const first =
    index === -1 ? undefined : { index, actual: actualBits[index], expected: expectedBits[index] };
  expect(first).toBeUndefined();
}

function planChannels(fixture: FixtureCase, count: number, seed: number): ChannelPlan[] {
  const next = random(seed);
  return Array.from({ length: count }, (_, channel) => {
    if (fixture.encoding.kind === 'integer') return integerChannel(fixture.encoding.bits, next);
    return fixture.encoding.bits === 32 ? float32Channel(seed * 8 + channel) : float64Channel(next);
  });
}

/** Reads `frames` frames from `start` and checks each sample's bits against the plan. */
async function expectFrames(
  reader: AudioReader,
  plans: readonly ChannelPlan[],
  start: number,
  frames: number,
): Promise<void> {
  const into = plans.map(() => new Float32Array(frames));
  const read = expectSuccess(await reader.read(start as SampleCount, frames, into));
  const available = Math.max(0, Math.min(frames, FRAMES - start));
  expect(read).toBe(available);
  for (const [channel, plan] of plans.entries()) {
    expectSameBits(into[channel]!.subarray(0, read), plan.expected.subarray(start, start + read));
  }
}

describe.each([...wavCases(), ...aiffCases()])('a $name fixture', (fixture) => {
  it('is recognised by its contents, described field by field and read bit for bit at every rate and layout', async () => {
    let seed = 1;
    for (const layout of LAYOUTS) {
      for (const rate of RATES) {
        seed += 1;
        const plans = planChannels(fixture, layout.count, seed);
        const file = fixture.write(
          plans.map((plan) => plan.written),
          rate,
          layout,
        );
        expect(expectSuccess(await recogniseAudio(memoryBytes(file)))).toEqual({
          kind: fixture.container,
        });
        const reader = expectSuccess(await openAudio(memoryBytes(file)));
        const stated = fixture.statesLayout ? layout.stated : undefined;
        expect(reader.format).toEqual({
          container: fixture.container,
          sampleRate: rate,
          encoding: fixture.encoding,
          channelCount: layout.count,
          statedLayout: stated,
          layout: stated ?? layout.fallback,
          frames: FRAMES,
          declaredFrames: FRAMES,
          dataOffset: expectedDataOffset(file, fixture.container),
          blockAlign: layout.count * fixture.encoding.bytes,
        });
        await expectFrames(reader, plans, 0, FRAMES);
      }
    }
  });

  it('reads from any start for any length, to the very end and no further', async () => {
    const layout = LAYOUTS[2]!;
    const plans = planChannels(fixture, layout.count, 99);
    const file = fixture.write(
      plans.map((plan) => plan.written),
      48_000,
      layout,
    );
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    for (const [start, frames] of [
      [0, 1],
      [5, 7],
      [13, 24],
      [FRAMES - 1, 1],
      [FRAMES - 3, 10],
      [FRAMES, 4],
      [0, 0],
    ] as const) {
      await expectFrames(reader, plans, start, frames);
    }
  });
});

describe('reading in bounded pieces', () => {
  const frames = 200_000;
  const next = random(7);
  const codes = Array.from({ length: 2 }, () =>
    Array.from({ length: frames }, () => Math.floor(next() * 2 ** 24) - 2 ** 23),
  );
  const file = writeWav({
    sampleRate: 48_000,
    encoding: { kind: 'integer', bits: 24 },
    channels: codes.map((channel) => Float64Array.from(channel, (code) => code / 2 ** 23)),
  });

  it('reads more than the largest piece in pieces of at most 1 MiB, asking only for the frames read', async () => {
    const bytes = memoryBytes(file);
    const reader = expectSuccess(await openAudio(bytes));
    const before = bytes.requests.length;
    const start = 12_345;
    const length = 180_001;
    const into = [new Float32Array(length), new Float32Array(length)];
    expect(expectSuccess(await reader.read(start as SampleCount, length, into))).toBe(length);
    const reads = bytes.requests.slice(before);
    expect(reads.length).toBeGreaterThan(1);
    expect(Math.max(...reads.map((read) => read.length))).toBeLessThanOrEqual(1 << 20);
    expect(reads.reduce((total, read) => total + read.length, 0)).toBe(length * 6);
    expect(reads[0]?.offset).toBe(reader.format.dataOffset + start * 6);
    for (const [channel, samples] of into.entries()) {
      const expected = Float32Array.from(
        codes[channel]!.slice(start, start + length),
        (code) => code / 2 ** 23,
      );
      expectSameBits(samples, expected);
    }
  });
});

describe('the conversion rule', () => {
  it('rounds a 64-bit float to the nearest float32, ties to even', async () => {
    const file = writeWav({
      sampleRate: 48_000,
      encoding: { kind: 'float', bits: 64 },
      channels: [Float64Array.of(1 + 2 ** -24, 1 + 3 * 2 ** -24, -(1 + 2 ** -23 + 2 ** -25))],
    });
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    const into = [new Float32Array(3)];
    await reader.read(0 as SampleCount, 3, into);
    expect(Array.from(bitsOf(into[0]!))).toEqual([0x3f800000, 0x3f800002, 0xbf800001]);
  });

  it('reads the extremes of each integer depth as −1 and one step short of 1', async () => {
    const cases = [
      { bits: 8, low: 0xbf800000, high: 0x3f7e0000 },
      { bits: 16, low: 0xbf800000, high: 0x3f7ffe00 },
      { bits: 24, low: 0xbf800000, high: 0x3f7ffffe },
      // 1 − 2^-31 is nearer 1 than any float32 below it, so it rounds up to 1.
      { bits: 32, low: 0xbf800000, high: 0x3f800000 },
    ];
    for (const { bits, low, high } of cases) {
      const half = 2 ** (bits - 1);
      const file = writeWav({
        sampleRate: 48_000,
        encoding: { kind: 'integer', bits },
        channels: [Float64Array.of(-1, (half - 1) / half)],
      });
      const into = [new Float32Array(2)];
      await expectSuccess(await openAudio(memoryBytes(file))).read(0 as SampleCount, 2, into);
      expect(Array.from(bitsOf(into[0]!))).toEqual([low, high]);
    }
  });
});

describe('the layout a header states', () => {
  async function layoutsOf(file: Uint8Array): Promise<[ChannelLayout | undefined, ChannelLayout]> {
    const format = expectSuccess(await openAudio(memoryBytes(file))).format;
    return [format.statedLayout, format.layout];
  }
  const silent = (count: number) => Array.from({ length: count }, () => new Float64Array(4));
  const wav = (count: number, channelMask: number) =>
    writeWav({
      sampleRate: 48_000,
      encoding: { kind: 'integer', bits: 16 },
      channels: silent(count),
      extensible: { channelMask },
    });
  const aiff = (count: number, layout?: Uint8Array) =>
    writeAiff({
      sampleSize: 16,
      sampleRate: 48_000,
      channels: silent(count),
      ...(layout === undefined ? {} : { channelLayout: layout }),
    });
  const { Left, Right, Centre, LowFrequency, SurroundLeft, SurroundRight, Discrete, TopRearRight } =
    ChannelRole;

  it('maps the side-surround 5.1 mask to the surround roles', async () => {
    expect((await layoutsOf(wav(6, 0x60f)))[0]?.roles).toEqual([
      Left,
      Right,
      Centre,
      LowFrequency,
      SurroundLeft,
      SurroundRight,
    ]);
  });

  it('gives the channels past a short mask, and a bit with no role, no position', async () => {
    expect((await layoutsOf(wav(3, 0x3)))[0]?.roles).toEqual([Left, Right, Discrete]);
    expect((await layoutsOf(wav(3, 0x80000003)))[0]?.roles).toEqual([Left, Right, Discrete]);
    expect((await layoutsOf(wav(1, 0x20000)))[0]?.roles).toEqual([TopRearRight]);
  });

  it('takes only as many speakers as channels from a mask that names more', async () => {
    expect((await layoutsOf(wav(2, 0x3f)))[0]?.roles).toEqual([Left, Right]);
  });

  it('states no layout for a zero mask, and falls back to the format default', async () => {
    expect(await layoutsOf(wav(2, 0))).toEqual([undefined, { roles: [Left, Right] }]);
  });

  it('reads CoreAudio channel descriptions, bitmaps and the mono and stereo tags', async () => {
    expect(
      (await layoutsOf(aiff(3, channelLayoutBody({ tag: 0, labels: [1, 2, 4] }))))[0]?.roles,
    ).toEqual([Left, Right, LowFrequency]);
    expect(
      (await layoutsOf(aiff(2, channelLayoutBody({ tag: 0, labels: [10, 0] }))))[0]?.roles,
    ).toEqual([SurroundLeft, Discrete]);
    expect(
      (await layoutsOf(aiff(2, channelLayoutBody({ tag: 1 << 16, bitmap: 0x600 }))))[0]?.roles,
    ).toEqual([SurroundLeft, SurroundRight]);
    expect(
      (await layoutsOf(aiff(1, channelLayoutBody({ tag: (100 << 16) | 1 }))))[0]?.roles,
    ).toEqual([ChannelRole.Mono]);
    expect(
      (await layoutsOf(aiff(2, channelLayoutBody({ tag: (101 << 16) | 2 }))))[0]?.roles,
    ).toEqual([Left, Right]);
  });

  it('states no layout where CHAN names one the reader cannot, or one that is not the file’s', async () => {
    const fallback: ChannelLayout = { roles: [Left, Right] };
    for (const body of [
      channelLayoutBody({ tag: (102 << 16) | 2 }),
      channelLayoutBody({ tag: (100 << 16) | 1 }),
      channelLayoutBody({ tag: 0, labels: [1] }),
      channelLayoutBody({ tag: 0, labels: [1, 1] }),
      Uint8Array.of(0, 0),
    ]) {
      expect(await layoutsOf(aiff(2, body))).toEqual([undefined, fallback]);
    }
    expect(await layoutsOf(aiff(2))).toEqual([undefined, fallback]);
  });
});

describe('the parts of a form a reader passes over', () => {
  const channels = [Float64Array.of(0.5, -0.5, 0.25)];

  it('ignores a WAV fact chunk for PCM', async () => {
    const file = writeWav({
      sampleRate: 44_100,
      encoding: { kind: 'integer', bits: 16 },
      channels,
      factFrames: 999,
    });
    expect(expectSuccess(await openAudio(memoryBytes(file))).format.frames).toBe(3);
  });

  it('reads RF64 sizes from the ds64 table and odd chunks before the format', async () => {
    const big = { id: 'big1', body: Uint8Array.of(1, 2, 3, 4, 5) };
    const file = writeWav({
      form: 'rf64',
      sampleRate: 44_100,
      encoding: { kind: 'integer', bits: 16 },
      channels,
      beforeFormat: [BEFORE[0]!],
      beforeData: [big],
      sizesInDs64: ['big1'],
    });
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    const into = [new Float32Array(3)];
    expect(expectSuccess(await reader.read(0 as SampleCount, 3, into))).toBe(3);
    expect(Array.from(into[0]!)).toEqual([0.5, -0.5, 0.25]);
  });

  it('reads an AIFF whose COMM chunk follows its samples', async () => {
    const file = writeAiff({
      sampleSize: 16,
      sampleRate: 22_050,
      channels,
      commonAfterSound: true,
      soundOffset: 5,
    });
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    const into = [new Float32Array(3)];
    await reader.read(0 as SampleCount, 3, into);
    expect(reader.format.sampleRate).toBe(22_050);
    expect(Array.from(into[0]!)).toEqual([0.5, -0.5, 0.25]);
  });
});
