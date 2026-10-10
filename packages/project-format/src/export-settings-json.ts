/**
 * Writing and reading an export's settings (`@audiogubbins/import-export`'s
 * `ExportSettings`, ADR-0092) wherever the project keeps them: the settings it
 * was last exported with, and the settings each export record names
 * (REQ-STOR-197, REQ-EXEC-136.12).
 *
 * The reader holds every member to its type: each format's own encoding, the
 * literal depths and durations the types allow, whole numbers where a count or
 * a seed is meant, and finite numbers elsewhere. Whether settings can be made
 * by the codecs this browser has is not a property of the document: settings
 * kept from one machine are read on another and checked there, against its
 * codecs, by `validateExportSettings` before an export begins.
 */

import type { FixedNamedMatrix } from '@audiogubbins/audio-engine';
import type { MetadataTextKey } from '@audiogubbins/codecs';
import { MAXIMUM_CHANNEL_COUNT, unsafeBrandId } from '@audiogubbins/domain';
import type {
  ChannelConversion,
  CommonExportSettings,
  DitherSettings,
  ExportFormat,
  ExportRange,
  ExportSettings,
  FormatEncodings,
  MetadataEdit,
  MetadataSettings,
  NoiseShaping,
  OpusApplication,
} from '@audiogubbins/import-export';

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  listConverter,
  objectOf,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import {
  asId,
  integerConverter,
  namedValueConverter,
  numberConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';
import { writeLayout } from './value-writing.js';
import { asChannelLayout, asSampleCount, asSampleRate } from './value-reading.js';

const COMMON_MEMBERS = [
  'format',
  'encoding',
  'sampleRate',
  'channels',
  'dither',
  'range',
  'metadata',
  'fileName',
] as const;
const SETTINGS_MEMBERS: ReadonlySet<string> = new Set(COMMON_MEMBERS);

const asFormat = namedValueConverter<ExportFormat>({
  wav: true,
  aiff: true,
  aifc: true,
  flac: true,
  mp3: true,
  'ogg-vorbis': true,
  opus: true,
  aac: true,
});

const asMatrix = namedValueConverter<FixedNamedMatrix>({
  'itu-bs775-5.1-to-stereo': true,
  'mid-side-encode': true,
  'mid-side-decode': true,
});

const asShaping = namedValueConverter<NoiseShaping>({
  none: true,
  'first-order': true,
  'lipshitz-e-weighted': true,
});

const asApplication = namedValueConverter<OpusApplication>({
  audio: true,
  voip: true,
  'restricted-low-delay': true,
});

const asTextKey = namedValueConverter<MetadataTextKey>({
  title: true,
  artist: true,
  album: true,
  albumArtist: true,
  trackNumber: true,
  trackTotal: true,
  discNumber: true,
  discTotal: true,
  date: true,
  genre: true,
  comment: true,
  copyright: true,
  encoder: true,
  isrc: true,
});

/** Converters of numbers to the literal values a type allows. */
function literalConverter<TValue extends number>(values: readonly TValue[]): Converter<TValue> {
  return (reading, value, parent, key) => {
    const found = values.find((candidate) => candidate === value);
    if (found === undefined) {
      reading.refuse(
        'schema.unknown-value',
        `One of ${values.join(', ')} is expected here.`,
        pathOf(parent, key),
      );
    }
    return found;
  };
}

const asIntegerBits = literalConverter([8, 16, 24, 32] as const);
const asFloatBits = literalConverter([32, 64] as const);
const asFlacBits = literalConverter([16, 24, 32] as const);
const asFrameDuration = literalConverter([2.5, 5, 10, 20, 40, 60] as const);

/** A count or a level a setting takes: whole, and far within what any codec states. */
const asWhole = integerConverter(-(2 ** 31), 2 ** 31);

/** A rate, quality or amplitude: finite, and far within what any codec states. */
const asFinite = numberConverter(-(2 ** 31), 2 ** 31);
const asSeed = integerConverter(0, 2 ** 32 - 1);
const asMetadataText = textConverter({ maximumLength: 65_536 });
const asTemplate = textConverter({ maximumLength: 1_024 });
const asChannelIndex = integerConverter(0, MAXIMUM_CHANNEL_COUNT - 1);
const asChannelIndices = listConverter(MAXIMUM_CHANNEL_COUNT, asChannelIndex);

/** An object whose members depend on its `kind`, read as `members` of that kind say. */
function kindOf<TKind extends string>(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  member: string,
  kinds: Readonly<Record<TKind, ReadonlySet<string>>>,
): { readonly object: JsonObject; readonly at: string; readonly kind: TKind } | undefined {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const named = Object.keys(kinds).filter((kind): kind is TKind => kind in kinds);
  const kind = required(reading, object, at, member, oneOfConverter(named));
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, kinds[kind]);
  return { object, at, kind };
}

const members = (...names: string[]): ReadonlySet<string> => new Set(names);

const asPcm: Converter<FormatEncodings['wav']> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    integer: members('kind', 'bits'),
    float: members('kind', 'bits'),
    'a-law': members('kind'),
    'mu-law': members('kind'),
    'ima-adpcm': members('kind'),
    'ms-adpcm': members('kind'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  switch (kind) {
    case 'integer': {
      const bits = required(reading, object, at, 'bits', asIntegerBits);
      return bits === undefined ? undefined : { kind, bits };
    }
    case 'float': {
      const bits = required(reading, object, at, 'bits', asFloatBits);
      return bits === undefined ? undefined : { kind, bits };
    }
    default:
      return { kind };
  }
};

/**
 * Reads the encoding of `format` and joins it to `common`, the settings every
 * format shares, refusing an encoding the format does not hold. Answers
 * nothing where either could not be read.
 */
function formatSettings(
  reading: Reading,
  format: ExportFormat,
  object: JsonObject,
  at: string,
  common: CommonExportSettings | undefined,
): ExportSettings | undefined {
  const value = object['encoding'];
  if (value === undefined) {
    reading.refuse(
      'schema.missing-member',
      'The member "encoding" is required.',
      pathOf(at, 'encoding'),
    );
    return undefined;
  }
  switch (format) {
    case 'wav': {
      const encoding = asPcm(reading, value, at, 'encoding');
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
    case 'aiff': {
      const encoding = heldPcm(reading, value, at, (pcm) =>
        pcm.kind === 'integer' ? pcm : undefined,
      );
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
    case 'aifc': {
      const encoding = heldPcm(reading, value, at, (pcm): FormatEncodings['aifc'] | undefined => {
        switch (pcm.kind) {
          case 'ms-adpcm':
            return undefined;
          case 'integer':
          case 'float':
            return pcm;
          default:
            return { kind: pcm.kind };
        }
      });
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
    case 'flac': {
      const encoding = readFlac(reading, value, at);
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
    case 'mp3': {
      const encoding = readMp3(reading, value, at);
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
    case 'ogg-vorbis': {
      const encoding = readVorbis(reading, value, at);
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
    case 'opus': {
      const encoding = readOpus(reading, value, at);
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
    case 'aac': {
      const encoding = readAac(reading, value, at);
      return encoding === undefined || common === undefined
        ? undefined
        : { ...common, format, encoding };
    }
  }
}

/** A PCM encoding the format holds, as `held` answers, refusing one it does not. */
function heldPcm<TEncoding>(
  reading: Reading,
  value: JsonValue,
  at: string,
  held: (pcm: FormatEncodings['wav']) => TEncoding | undefined,
): TEncoding | undefined {
  const pcm = asPcm(reading, value, at, 'encoding');
  if (pcm === undefined) return undefined;
  const encoding = held(pcm);
  if (encoding === undefined) {
    reading.refuse(
      'export-settings.encoding-not-held',
      'The format does not hold this encoding.',
      pathOf(at, 'encoding'),
    );
  }
  return encoding;
}

function readAac(
  reading: Reading,
  value: JsonValue,
  at: string,
): FormatEncodings['aac'] | undefined {
  const object = objectOf(reading, value, at, 'encoding', members('bitRate'));
  if (object === undefined) return undefined;
  const bitRate = required(reading, object, pathOf(at, 'encoding'), 'bitRate', asFinite);
  return bitRate === undefined ? undefined : { bitRate };
}

function readFlac(
  reading: Reading,
  value: JsonValue,
  at: string,
): FormatEncodings['flac'] | undefined {
  const object = objectOf(reading, value, at, 'encoding', members('bits', 'compressionLevel'));
  if (object === undefined) return undefined;
  const inner = pathOf(at, 'encoding');
  const bits = required(reading, object, inner, 'bits', asFlacBits);
  const compressionLevel = required(reading, object, inner, 'compressionLevel', asWhole);
  return bits === undefined || compressionLevel === undefined
    ? undefined
    : { bits, compressionLevel };
}

function readMp3(
  reading: Reading,
  value: JsonValue,
  at: string,
): FormatEncodings['mp3'] | undefined {
  const read = kindOf(reading, value, at, 'encoding', 'mode', {
    constant: members('mode', 'bitRate'),
    average: members('mode', 'bitRate'),
    variable: members('mode', 'quality'),
  });
  if (read === undefined) return undefined;
  const { object, at: inner, kind: mode } = read;
  if (mode === 'variable') {
    const quality = required(reading, object, inner, 'quality', asWhole);
    return quality === undefined ? undefined : { mode, quality };
  }
  const bitRate = required(reading, object, inner, 'bitRate', asFinite);
  return bitRate === undefined ? undefined : { mode, bitRate };
}

function readVorbis(
  reading: Reading,
  value: JsonValue,
  at: string,
): FormatEncodings['ogg-vorbis'] | undefined {
  const read = kindOf(reading, value, at, 'encoding', 'mode', {
    quality: members('mode', 'quality'),
    'bit-rate': members('mode', 'nominalBitRate'),
  });
  if (read === undefined) return undefined;
  const { object, at: inner, kind: mode } = read;
  if (mode === 'quality') {
    const quality = required(reading, object, inner, 'quality', asFinite);
    return quality === undefined ? undefined : { mode, quality };
  }
  const nominalBitRate = required(reading, object, inner, 'nominalBitRate', asFinite);
  return nominalBitRate === undefined ? undefined : { mode, nominalBitRate };
}

function readOpus(
  reading: Reading,
  value: JsonValue,
  at: string,
): FormatEncodings['opus'] | undefined {
  const object = objectOf(
    reading,
    value,
    at,
    'encoding',
    members('bitRate', 'application', 'frameDuration', 'complexity'),
  );
  if (object === undefined) return undefined;
  const inner = pathOf(at, 'encoding');
  const bitRate = required(reading, object, inner, 'bitRate', asFinite);
  const application = required(reading, object, inner, 'application', asApplication);
  const frameDuration = required(reading, object, inner, 'frameDuration', asFrameDuration);
  const complexity = required(reading, object, inner, 'complexity', asWhole);
  return bitRate === undefined ||
    application === undefined ||
    frameDuration === undefined ||
    complexity === undefined
    ? undefined
    : { bitRate, application, frameDuration, complexity };
}

const asChannels: Converter<ChannelConversion> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    keep: members('kind'),
    fold: members('kind', 'to'),
    matrix: members('kind', 'matrix'),
    map: members('kind', 'channels', 'to'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  switch (kind) {
    case 'keep':
      return { kind };
    case 'fold': {
      const to = required(reading, object, at, 'to', asChannelLayout);
      return to === undefined ? undefined : { kind, to };
    }
    case 'matrix': {
      const matrix = required(reading, object, at, 'matrix', asMatrix);
      return matrix === undefined ? undefined : { kind, matrix };
    }
    case 'map': {
      const channels = required(reading, object, at, 'channels', asChannelIndices);
      const to = required(reading, object, at, 'to', asChannelLayout);
      return channels === undefined || to === undefined ? undefined : { kind, channels, to };
    }
  }
};

const asDither: Converter<DitherSettings> = (reading, value, parent, key) => {
  const noise = members('kind', 'amplitude', 'shaping', 'seed');
  const read = kindOf(reading, value, parent, key, 'kind', {
    none: members('kind'),
    rectangular: noise,
    triangular: noise,
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'none') return { kind };
  const amplitude = required(reading, object, at, 'amplitude', asFinite);
  const shaping = required(reading, object, at, 'shaping', asShaping);
  const seed = required(reading, object, at, 'seed', asSeed);
  return amplitude === undefined || shaping === undefined || seed === undefined
    ? undefined
    : { kind, amplitude, shaping, seed };
};

const asRange: Converter<ExportRange> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    project: members('kind'),
    region: members('kind', 'region'),
    'every-region': members('kind'),
    selection: members('kind', 'start', 'length'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  switch (kind) {
    case 'project':
    case 'every-region':
      return { kind };
    case 'region': {
      const region = required(reading, object, at, 'region', asId<'RegionId'>);
      return region === undefined ? undefined : { kind, region: unsafeBrandId<'RegionId'>(region) };
    }
    case 'selection': {
      const start = required(reading, object, at, 'start', asSampleCount);
      const length = required(reading, object, at, 'length', asSampleCount);
      return start === undefined || length === undefined ? undefined : { kind, start, length };
    }
  }
};

const asEdit: Converter<MetadataEdit> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    set: members('kind', 'key', 'value'),
    remove: members('kind', 'key'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  const field = required(reading, object, at, 'key', asTextKey);
  if (kind === 'remove') return field === undefined ? undefined : { kind, key: field };
  const text = required(reading, object, at, 'value', asMetadataText);
  return field === undefined || text === undefined ? undefined : { kind, key: field, value: text };
};

const asPolicy = oneOfConverter(['full', 'minimal', 'none'] as const);
const asEdits = listConverter(256, asEdit);

const asMetadata: Converter<MetadataSettings> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, members('policy', 'edits'));
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const policy = required(reading, object, at, 'policy', asPolicy);
  const edits = required(reading, object, at, 'edits', asEdits);
  return policy === undefined || edits === undefined ? undefined : { policy, edits };
};

/** Reads an export's settings (see the module comment). */
export const readExportSettings: Converter<ExportSettings> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SETTINGS_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const format = required(reading, object, at, 'format', asFormat);
  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const channels = required(reading, object, at, 'channels', asChannels);
  const dither = required(reading, object, at, 'dither', asDither);
  const range = required(reading, object, at, 'range', asRange);
  const metadata = required(reading, object, at, 'metadata', asMetadata);
  const fileName = required(reading, object, at, 'fileName', asTemplate);
  if (format === undefined) return undefined;
  const common =
    sampleRate === undefined ||
    channels === undefined ||
    dither === undefined ||
    range === undefined ||
    metadata === undefined ||
    fileName === undefined
      ? undefined
      : { sampleRate, channels, dither, range, metadata, fileName };
  return formatSettings(reading, format, object, at, common);
};

/** Writes an export's settings. */
export function writeExportSettings(settings: ExportSettings): JsonObject {
  return {
    format: settings.format,
    encoding: { ...settings.encoding },
    sampleRate: settings.sampleRate,
    channels: writeChannels(settings.channels),
    dither: { ...settings.dither },
    range: { ...settings.range },
    metadata: {
      policy: settings.metadata.policy,
      edits: settings.metadata.edits.map((edit) => ({ ...edit })),
    },
    fileName: settings.fileName,
  };
}

function writeChannels(channels: ChannelConversion): JsonObject {
  switch (channels.kind) {
    case 'keep':
    case 'matrix':
      return { ...channels };
    case 'fold':
      return { kind: channels.kind, to: writeLayout(channels.to) };
    case 'map':
      return presentMembers({
        kind: channels.kind,
        channels: [...channels.channels],
        to: writeLayout(channels.to),
      });
  }
}
