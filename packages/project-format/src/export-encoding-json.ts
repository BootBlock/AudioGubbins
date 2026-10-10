/**
 * Reading each format's encoding of an export's settings
 * (`export-settings-json.ts`, ADR-0092, REQ-EXEC-136.12): its own members, the
 * literal depths and durations its type allows, and a PCM code only where the
 * format holds it.
 */

import type {
  CommonExportSettings,
  ExportFormat,
  ExportSettings,
  FormatEncodings,
  OpusApplication,
} from '@audiogubbins/import-export';

import type { JsonObject, JsonValue } from './canonical-json.js';
import { objectOf, pathOf, required, type Converter, type Reading } from './document-reading.js';
import { integerConverter, namedValueConverter, numberConverter } from './scalar-reading.js';
import { kindOf, literalConverter, members } from './variant-reading.js';

const asIntegerBits = literalConverter([8, 16, 24, 32] as const);
const asFloatBits = literalConverter([32, 64] as const);
const asFlacBits = literalConverter([16, 24, 32] as const);
const asFrameDuration = literalConverter([2.5, 5, 10, 20, 40, 60] as const);

/** A count or a level a setting takes: whole, and far within what any codec states. */
const asWhole = integerConverter(-(2 ** 31), 2 ** 31);

/** A rate, quality or amplitude: finite, and far within what any codec states. */
export const asFinite = numberConverter(-(2 ** 31), 2 ** 31);

const asApplication = namedValueConverter<OpusApplication>({
  audio: true,
  voip: true,
  'restricted-low-delay': true,
});

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
export function formatSettings(
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
  const read: Read = { reading, value, at, common };
  switch (format) {
    case 'wav':
    case 'aiff':
    case 'aifc':
      return pcmSettings(format, read);
    default:
      return codedSettings(format, read);
  }
}

/** What a format's encoding is read from, and the settings it is joined to. */
interface Read {
  readonly reading: Reading;
  readonly value: JsonValue;
  readonly at: string;
  readonly common: CommonExportSettings | undefined;
}

/** `encoding` joined to the common settings by `make`, where both were read. */
function joined<TEncoding>(
  encoding: TEncoding | undefined,
  { common }: Read,
  make: (encoding: TEncoding, common: CommonExportSettings) => ExportSettings,
): ExportSettings | undefined {
  return encoding === undefined || common === undefined ? undefined : make(encoding, common);
}

/** The settings of a format of PCM codes. */
function pcmSettings(format: 'wav' | 'aiff' | 'aifc', read: Read): ExportSettings | undefined {
  const { reading, value, at } = read;
  switch (format) {
    case 'wav':
      return joined(asPcm(reading, value, at, 'encoding'), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
    case 'aiff':
      return joined(heldPcm(reading, value, at, aiffEncoding), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
    case 'aifc':
      return joined(heldPcm(reading, value, at, aifcEncoding), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
  }
}

/** The settings of a format of a codec of its own. */
function codedSettings(
  format: Exclude<ExportFormat, 'wav' | 'aiff' | 'aifc'>,
  read: Read,
): ExportSettings | undefined {
  const { reading, value, at } = read;
  switch (format) {
    case 'flac':
      return joined(readFlac(reading, value, at), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
    case 'mp3':
      return joined(readMp3(reading, value, at), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
    case 'ogg-vorbis':
      return joined(readVorbis(reading, value, at), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
    case 'opus':
      return joined(readOpus(reading, value, at), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
    case 'aac':
      return joined(readAac(reading, value, at), read, (encoding, common) => ({
        ...common,
        format,
        encoding,
      }));
  }
}

/** AIFF holds integer PCM alone. */
function aiffEncoding(pcm: FormatEncodings['wav']): FormatEncodings['aiff'] | undefined {
  return pcm.kind === 'integer' ? pcm : undefined;
}

/** AIFF-C holds every PCM code WAV does but Microsoft ADPCM. */
function aifcEncoding(pcm: FormatEncodings['wav']): FormatEncodings['aifc'] | undefined {
  switch (pcm.kind) {
    case 'ms-adpcm':
      return undefined;
    case 'integer':
    case 'float':
      return pcm;
    default:
      return { kind: pcm.kind };
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
