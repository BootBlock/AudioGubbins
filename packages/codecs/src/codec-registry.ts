/**
 * The registry: one descriptor for every codec AudioGubbins names, built once
 * (ADR-0090), with the implementation ADR-0091 chose for each direction.
 *
 * Every question about a codec, whether recognition's (which codec a WAV tag
 * names), the import route's (read in place or decode) or a capability's (what
 * serves it here), is answered from these values, so a new format is a new
 * descriptor and its implementation, never another arm of a switch.
 *
 * The map's order is the order alternatives are offered in: the general codecs
 * before the telephony and legacy block codes, and within each the ones that
 * keep the most of the sound first.
 */

import type { CodecDescriptor, CodecDirection, CodecId, ContainerId } from './codec-descriptor.js';

/** The rates the domain works at, which a codec with no limit of its own accepts. */
const ANY_RATE = { kind: 'any', minimum: 8_000, maximum: 768_000 } as const;

/** The most channels the domain holds, which a codec with no lower limit accepts. */
const DOMAIN_CHANNELS = 256;

/** The rates of MPEG-1, MPEG-2 and MPEG-2.5 audio, the only ones an MP3 frame can state. */
const MPEG_RATES = {
  kind: 'listed',
  rates: [8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000],
} as const;

/** The rates AAC's sampling-frequency index names (ISO/IEC 14496-3), above the domain's floor. */
const AAC_RATES = {
  kind: 'listed',
  rates: [
    8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 64_000, 88_200, 96_000,
  ],
} as const;

/** The containers the application reads and writes block-coded and uncompressed audio in. */
const RIFF_FORMS: readonly ContainerId[] = ['wav', 'rf64', 'bw64'];

/** The licence of AudioGubbins' own code, which serves the application's codecs. */
const APPLICATION_LICENCE = 'Apache-2.0';

/** Symphonia's licence, which decodes every format the codec module reads but Opus. */
const SYMPHONIA_LICENCE = 'MPL-2.0';

/**
 * A browser's codec is the platform's, shipped by nobody here, so its licence
 * is not one AudioGubbins can assert; SPDX's word for that is NOASSERTION.
 */
const BROWSER_LICENCE = 'NOASSERTION';

/** The application's own codec in one direction, over these containers. */
function application(containers: readonly ContainerId[]): CodecDirection {
  return {
    implementation: 'application',
    containers,
    reproducible: true,
    licence: APPLICATION_LICENCE,
    sampleRates: ANY_RATE,
    maximumChannels: DOMAIN_CHANNELS,
  };
}

/** The codes no RIFF or AIFF-C header names a codec by. */
const NO_CODES = { waveFormatTags: [], aifcCompressionTypes: [] } as const;

/** Every codec, by its id, so the compiler holds that each `CodecId` has its descriptor. */
const DESCRIPTORS: Readonly<Record<CodecId, CodecDescriptor>> = {
  pcm: {
    id: 'pcm',
    name: 'uncompressed PCM',
    lossless: true,
    // 0xFFFE, the extensible form, is not a codec: its sub-format carries one of these.
    codes: {
      waveFormatTags: [0x0001, 0x0003],
      aifcCompressionTypes: [
        'NONE',
        'twos',
        'sowt',
        'in24',
        'in32',
        '23ni',
        '42ni',
        'raw ',
        'fl32',
        'FL32',
        'fl64',
        'FL64',
      ],
    },
    read: application([...RIFF_FORMS, 'aiff', 'aifc']),
    write: application([...RIFF_FORMS, 'aiff', 'aifc']),
  },
  flac: {
    id: 'flac',
    name: 'FLAC',
    lossless: true,
    codes: NO_CODES,
    read: {
      implementation: 'codec-module',
      containers: ['flac', 'ogg'],
      reproducible: true,
      licence: SYMPHONIA_LICENCE,
      // A FLAC frame header states its rate in tens of hertz at most, so 655 350 Hz is its ceiling.
      sampleRates: { kind: 'any', minimum: 8_000, maximum: 655_350 },
      maximumChannels: 8,
    },
    write: {
      implementation: 'codec-module',
      containers: ['flac'],
      reproducible: true,
      // flacenc, the codec module's FLAC encoder.
      licence: 'Apache-2.0',
      sampleRates: { kind: 'any', minimum: 8_000, maximum: 655_350 },
      maximumChannels: 8,
    },
  },
  alac: {
    id: 'alac',
    name: 'Apple Lossless (ALAC)',
    lossless: true,
    codes: NO_CODES,
    read: {
      implementation: 'codec-module',
      containers: ['mp4'],
      reproducible: true,
      licence: SYMPHONIA_LICENCE,
      sampleRates: { kind: 'any', minimum: 8_000, maximum: 384_000 },
      maximumChannels: 8,
    },
    write: undefined,
  },
  opus: {
    id: 'opus',
    name: 'Opus',
    lossless: false,
    codes: NO_CODES,
    read: {
      implementation: 'codec-module',
      containers: ['ogg', 'webm', 'matroska'],
      reproducible: true,
      licence: 'BSD-3-Clause',
      // An Opus decoder always gives 48 kHz, whatever input rate the stream's header records.
      sampleRates: { kind: 'listed', rates: [48_000] },
      maximumChannels: 255,
    },
    write: {
      implementation: 'codec-module',
      containers: ['ogg'],
      reproducible: true,
      licence: 'BSD-3-Clause',
      sampleRates: { kind: 'listed', rates: [8_000, 12_000, 16_000, 24_000, 48_000] },
      // Channel mapping family 1, the one whose order Ogg Opus defines for speakers, ends at eight.
      maximumChannels: 8,
    },
  },
  vorbis: {
    id: 'vorbis',
    name: 'Vorbis',
    lossless: false,
    codes: NO_CODES,
    read: {
      implementation: 'codec-module',
      containers: ['ogg', 'webm', 'matroska'],
      reproducible: true,
      licence: SYMPHONIA_LICENCE,
      sampleRates: ANY_RATE,
      maximumChannels: 255,
    },
    write: {
      implementation: 'prebuilt-module',
      containers: ['ogg'],
      // libvorbis in one fixed WebAssembly build: WebAssembly's floating point
      // is IEEE-754 without extended precision or fused operations, so the same
      // samples and settings give the same bytes on every machine.
      reproducible: true,
      licence: 'BSD-3-Clause',
      // libvorbis has encoder setups from 8 kHz to 192 kHz, and Vorbis I orders speakers for one to eight channels.
      sampleRates: { kind: 'any', minimum: 8_000, maximum: 192_000 },
      maximumChannels: 8,
    },
  },
  mp3: {
    id: 'mp3',
    name: 'MP3',
    lossless: false,
    // WAVE_FORMAT_MPEGLAYER3: MP3 frames carried in a WAV file, decoded as MP3 is.
    codes: { waveFormatTags: [0x0055], aifcCompressionTypes: [] },
    read: {
      implementation: 'codec-module',
      containers: ['mp3', 'wav'],
      reproducible: true,
      licence: SYMPHONIA_LICENCE,
      sampleRates: MPEG_RATES,
      maximumChannels: 2,
    },
    write: {
      implementation: 'prebuilt-module',
      containers: ['mp3'],
      // LAME 3.100 in one fixed WebAssembly build: its floating point is
      // IEEE-754 without extended precision or fused operations there, and it
      // reads no clock or random source, so the same samples and settings give
      // the same bytes on every machine.
      reproducible: true,
      licence: 'LGPL-2.0-or-later',
      sampleRates: MPEG_RATES,
      maximumChannels: 2,
    },
  },
  'aac-lc': {
    id: 'aac-lc',
    name: 'AAC-LC',
    lossless: false,
    codes: NO_CODES,
    read: {
      implementation: 'codec-module',
      containers: ['mp4', 'adts'],
      reproducible: true,
      licence: SYMPHONIA_LICENCE,
      sampleRates: AAC_RATES,
      maximumChannels: 8,
    },
    write: {
      implementation: 'browser',
      containers: ['mp4'],
      // Each browser's encoder is its own, so two machines may give different bytes (REQ-ARCH-081).
      reproducible: false,
      licence: BROWSER_LICENCE,
      sampleRates: AAC_RATES,
      maximumChannels: 8,
    },
  },
  'he-aac': {
    id: 'he-aac',
    name: 'HE-AAC',
    lossless: false,
    codes: NO_CODES,
    read: {
      implementation: 'browser',
      containers: ['mp4', 'adts'],
      reproducible: false,
      licence: BROWSER_LICENCE,
      sampleRates: AAC_RATES,
      maximumChannels: 8,
    },
    write: undefined,
  },
  'g711-alaw': {
    id: 'g711-alaw',
    name: 'A-law',
    lossless: false,
    codes: { waveFormatTags: [0x0006], aifcCompressionTypes: ['alaw', 'ALAW'] },
    read: application([...RIFF_FORMS, 'aifc']),
    write: application([...RIFF_FORMS, 'aifc']),
  },
  'g711-ulaw': {
    id: 'g711-ulaw',
    name: 'µ-law',
    lossless: false,
    codes: { waveFormatTags: [0x0007], aifcCompressionTypes: ['ulaw', 'ULAW'] },
    read: application([...RIFF_FORMS, 'aifc']),
    write: application([...RIFF_FORMS, 'aifc']),
  },
  'ima-adpcm': {
    id: 'ima-adpcm',
    name: 'IMA ADPCM',
    lossless: false,
    codes: { waveFormatTags: [0x0011], aifcCompressionTypes: ['ima4'] },
    read: application([...RIFF_FORMS, 'aifc']),
    write: application([...RIFF_FORMS, 'aifc']),
  },
  'ms-adpcm': {
    id: 'ms-adpcm',
    name: 'Microsoft ADPCM',
    lossless: false,
    codes: { waveFormatTags: [0x0002], aifcCompressionTypes: [] },
    read: application(RIFF_FORMS),
    write: application(RIFF_FORMS),
  },
};

const ORDERED: readonly CodecDescriptor[] = Object.values(DESCRIPTORS);

/** Every codec AudioGubbins names, by its id, in the order alternatives are offered. */
export const CODEC_REGISTRY: ReadonlyMap<CodecId, CodecDescriptor> = new Map(
  ORDERED.map((descriptor) => [descriptor.id, descriptor]),
);

/** The codec each WAV format tag names, from the descriptors' codes. */
export const WAVE_TAG_CODECS: ReadonlyMap<number, CodecId> = new Map(
  ORDERED.flatMap((descriptor) =>
    descriptor.codes.waveFormatTags.map((tag) => [tag, descriptor.id] as const),
  ),
);

/** The codec each AIFF-C compression type names, from the descriptors' codes. */
export const AIFC_TYPE_CODECS: ReadonlyMap<string, CodecId> = new Map(
  ORDERED.flatMap((descriptor) =>
    descriptor.codes.aifcCompressionTypes.map((type) => [type, descriptor.id] as const),
  ),
);

/** The descriptor of a codec, which every `CodecId` has. */
export function codecDescriptor(id: CodecId): CodecDescriptor {
  return DESCRIPTORS[id];
}
