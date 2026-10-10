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
): CodecDirection {
  return {
    implementation: 'application',
    containers,
    reproducible: true,
    licence: 'Apache-2.0',
    sampleRates,
    maximumChannels,
  };
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
      ),
    ),
  ],
  [
    'vorbis',
    codec(
      'vorbis',
      'Ogg Vorbis',
      writer(['ogg'], { kind: 'any', minimum: 8_000, maximum: 192_000 }, 8),
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
