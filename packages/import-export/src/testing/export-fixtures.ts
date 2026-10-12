/**
 * The codecs and projects this package's tests check settings against.
 *
 * The descriptors are written here, not taken from the registry, so the
 * rules are tested against stated values: every codec an export writes, with
 * the rates and channels a registry of this shape would give it.
 */

import {
  StandardLayouts,
  sampleCount,
  sampleRate,
  unsafeBrandId,
  type ChannelLayout,
  type RegionId,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type {
  BitRateBand,
  CodecDescriptor,
  CodecDirection,
  CodecId,
  ContainerId,
  SampleRateSupport,
} from '@audiogubbins/codecs';

import type {
  CodecLookup,
  ExportContext,
  ExportSource,
  ExportableRegion,
  SourcePrecision,
} from '../export-context.js';

export function rate(hertz: number): SampleRate {
  return expectSuccess(sampleRate(hertz));
}

const ANY_RATE: SampleRateSupport = { kind: 'any', minimum: 8_000, maximum: 384_000 };

function writer(
  containers: readonly ContainerId[],
  sampleRates: SampleRateSupport,
  maximumChannels: number,
  bitRates?: readonly BitRateBand[],
): CodecDirection {
  const direction: CodecDirection = {
    implementation: 'application',
    containers,
    reproducible: true,
    licence: 'Apache-2.0',
    sampleRates,
    maximumChannels,
  };
  return bitRates === undefined ? direction : { ...direction, bitRates };
}

const MPEG1_BIT_RATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BIT_RATES = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** An MP3 encoder's band: its rates, and its table for a constant or an average bit rate. */
function mp3Band(minimum: number, maximum: number, rates: readonly number[]): BitRateBand {
  const average = {
    minimum: (rates[0] ?? 0) * 1000,
    maximum: (rates.at(-1) ?? 0) * 1000,
    per: 'stream',
  } as const;
  return { sampleRates: { minimum, maximum }, constant: rates, average };
}

/** A Vorbis encoder's band of nominal bit rates a channel, for a channel count or any. */
function vorbisBand(
  minimum: number,
  maximum: number,
  channels: number | undefined,
  perChannel: readonly [number, number],
): BitRateBand {
  const band = {
    sampleRates: { minimum, maximum },
    average: { minimum: perChannel[0], maximum: perChannel[1], per: 'channel' },
  } as const;
  return channels === undefined ? band : { ...band, channels };
}

function codec(id: CodecId, name: string, write: CodecDirection | undefined): CodecDescriptor {
  return {
    id,
    name,
    lossless: false,
    codes: { waveFormatTags: [], aifcCompressionTypes: [] },
    read: undefined,
    write,
  };
}

/** A descriptor of every codec an export writes. */
export const TEST_CODECS: ReadonlyMap<CodecId, CodecDescriptor> = new Map([
  ['pcm', codec('pcm', 'PCM', writer(['wav', 'rf64', 'aiff', 'aifc'], ANY_RATE, 256))],
  ['g711-alaw', codec('g711-alaw', 'G.711 A-law', writer(['wav', 'aifc'], ANY_RATE, 256))],
  ['g711-ulaw', codec('g711-ulaw', 'G.711 µ-law', writer(['wav', 'aifc'], ANY_RATE, 256))],
  ['ima-adpcm', codec('ima-adpcm', 'IMA ADPCM', writer(['wav', 'aifc'], ANY_RATE, 2))],
  ['ms-adpcm', codec('ms-adpcm', 'Microsoft ADPCM', writer(['wav'], ANY_RATE, 2))],
  [
    'flac',
    codec('flac', 'FLAC', writer(['flac'], { kind: 'any', minimum: 8_000, maximum: 655_350 }, 8)),
  ],
  [
    'mp3',
    codec(
      'mp3',
      'MP3',
      writer(
        ['mp3'],
        {
          kind: 'listed',
          rates: [8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000],
        },
        2,
        [
          mp3Band(
            8_000,
            12_000,
            MPEG2_BIT_RATES.filter((rate) => rate <= 64),
          ),
          mp3Band(16_000, 24_000, MPEG2_BIT_RATES),
          mp3Band(32_000, 48_000, MPEG1_BIT_RATES),
        ],
      ),
    ),
  ],
  [
    'vorbis',
    codec(
      'vorbis',
      'Ogg Vorbis',
      // Nominal bit rates up to 50 kHz, to 70 kHz for six channels, and none above.
      writer(['ogg'], { kind: 'any', minimum: 8_000, maximum: 200_000 }, 8, [
        vorbisBand(40_000, 50_000, 2, [22_500, 250_001]),
        vorbisBand(40_000, 70_000, 6, [14_000, 240_001]),
        vorbisBand(40_000, 50_000, undefined, [32_000, 240_001]),
        vorbisBand(26_000, 40_000, undefined, [30_000, 190_000]),
      ]),
    ),
  ],
  [
    'opus',
    codec(
      'opus',
      'Opus',
      writer(['ogg'], { kind: 'listed', rates: [8_000, 12_000, 16_000, 24_000, 48_000] }, 8),
    ),
  ],
  [
    'aac-lc',
    codec(
      'aac-lc',
      'AAC',
      writer(
        ['mp4'],
        {
          kind: 'listed',
          rates: [
            8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 64_000, 88_200,
            96_000,
          ],
        },
        8,
      ),
    ),
  ],
]);

const testCodecs: CodecLookup = (id) => TEST_CODECS.get(id);

export const FIRST_REGION: RegionId = unsafeBrandId('region-first');
const SECOND_REGION: RegionId = unsafeBrandId('region-second');

function region(
  id: RegionId,
  name: string,
  start: number,
  length: number,
  project: ExportSource,
): ExportableRegion {
  return {
    id,
    name,
    start: expectSuccess(sampleCount(start)),
    length: expectSuccess(sampleCount(length)),
    sampleRate: project.sampleRate,
    layout: project.layout,
    precision: project.precision,
  };
}

/** A project of ten seconds with two regions. */
export function projectOf(
  options: {
    readonly hertz?: number;
    readonly layout?: ChannelLayout;
    readonly precision?: SourcePrecision;
  } = {},
): ExportSource {
  const project: ExportSource = {
    name: 'Door slam',
    sampleRate: rate(options.hertz ?? 48_000),
    layout: options.layout ?? StandardLayouts.stereo,
    precision: options.precision ?? { kind: 'integer', bits: 24 },
    length: expectSuccess(sampleCount(10 * (options.hertz ?? 48_000))),
    regions: [],
  };
  return {
    ...project,
    regions: [
      region(FIRST_REGION, 'Slam', 1_000, 20_000, project),
      region(SECOND_REGION, 'Creak', 40_000, 30_000, project),
    ],
  };
}

/** The context of a project made with these options, against every test codec. */
export function contextOf(options: Parameters<typeof projectOf>[0] = {}): ExportContext {
  return { source: projectOf(options), codecs: testCodecs };
}

/**
 * The context of a project made with these options, against every test codec,
 * AAC written by a browser's encoder that was probed to take `bands`.
 */
export function browserAacContextOf(
  bands: readonly BitRateBand[],
  options: Parameters<typeof projectOf>[0] = {},
): ExportContext {
  const aac = TEST_CODECS.get('aac-lc');
  const write = aac?.write;
  if (aac === undefined || write === undefined) throw new Error('The test codecs write AAC.');
  const browser: CodecDescriptor = {
    ...aac,
    write: { ...write, implementation: 'browser', bitRates: bands },
  };
  return {
    source: projectOf(options),
    codecs: (id) => (id === 'aac-lc' ? browser : testCodecs(id)),
  };
}
