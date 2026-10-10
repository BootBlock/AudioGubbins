/**
 * Reading an export's encode request that crossed into the codec worker,
 * field by field (REQ-EXEC-136.12): its target, its format's encoding in the
 * shape `ExportSettings` gives it, the rate, layout and metadata, and the
 * dither. The shape is read here; whether the values suit the format is the
 * settings' validation, done before the export was planned, and the
 * encoder's, which refuses what it cannot encode.
 */

import { metadataMapOf } from '@audiogubbins/codecs';
import {
  Malformed,
  fieldsAt,
  fieldsOf,
  layoutOf,
  numberOf,
  rateOf,
  textOf,
  type MessageFields,
} from '@audiogubbins/domain';
import type {
  AacEncoding,
  AifcEncoding,
  DitherSettings,
  ExportFormat,
  ExportTarget,
  FlacEncoding,
  FormatEncoding,
  IntegerPcm,
  Mp3Encoding,
  OpusEncoding,
  VorbisEncoding,
  WavEncoding,
} from '@audiogubbins/import-export';

import { codecOf, containerOf } from './codec-values-reading.js';
import type { ExportEncodeRequest } from './codec-worker-messages.js';

/** The value, named `field`, as one of `values`. */
function oneOfList<TValue extends string | number>(
  value: unknown,
  field: string,
  values: readonly TValue[],
): TValue {
  const found = values.find((one) => one === value);
  if (found === undefined) throw new Malformed(field, `one of ${values.join(', ')}`);
  return found;
}

const FORMATS: readonly ExportFormat[] = [
  'wav',
  'aiff',
  'aifc',
  'flac',
  'mp3',
  'ogg-vorbis',
  'opus',
  'aac',
];
const INTEGER_BITS = [8, 16, 24, 32] as const;
const FLOAT_BITS = [32, 64] as const;
const WAV_CODES = ['a-law', 'mu-law', 'ima-adpcm', 'ms-adpcm'] as const;
const AIFC_CODES = ['a-law', 'mu-law', 'ima-adpcm'] as const;
const FLAC_BITS = [16, 24, 32] as const;
const OPUS_APPLICATIONS = ['audio', 'voip', 'restricted-low-delay'] as const;
const OPUS_DURATIONS = [2.5, 5, 10, 20, 40, 60] as const;
const SHAPINGS = ['none', 'first-order', 'lipshitz-e-weighted'] as const;

function integerPcmOf(fields: MessageFields, field: string): IntegerPcm {
  return { kind: 'integer', bits: oneOfList(fields['bits'], `${field}.bits`, INTEGER_BITS) };
}

/** A PCM encoding of WAV or AIFF-C: integer, float, or one of `codes`. */
function pcmOf<TCode extends string>(
  value: unknown,
  field: string,
  codes: readonly TCode[],
): IntegerPcm | { readonly kind: 'float'; readonly bits: 32 | 64 } | { readonly kind: TCode } {
  const fields = fieldsOf(value, field);
  if (fields['kind'] === 'integer') return integerPcmOf(fields, field);
  if (fields['kind'] === 'float') {
    return { kind: 'float', bits: oneOfList(fields['bits'], `${field}.bits`, FLOAT_BITS) };
  }
  return { kind: oneOfList(fields['kind'], `${field}.kind`, codes) };
}

function wavOf(value: unknown, field: string): WavEncoding {
  return pcmOf(value, field, WAV_CODES);
}

function aifcOf(value: unknown, field: string): AifcEncoding {
  return pcmOf(value, field, AIFC_CODES);
}

function flacOf(value: unknown, field: string): FlacEncoding {
  const fields = fieldsOf(value, field);
  return {
    bits: oneOfList(fields['bits'], `${field}.bits`, FLAC_BITS),
    compressionLevel: numberOf(fields['compressionLevel'], `${field}.compressionLevel`),
  };
}

function mp3Of(value: unknown, field: string): Mp3Encoding {
  const fields = fieldsOf(value, field);
  if (fields['mode'] === 'variable') {
    return { mode: 'variable', quality: numberOf(fields['quality'], `${field}.quality`) };
  }
  return {
    mode: oneOfList(fields['mode'], `${field}.mode`, ['constant', 'average'] as const),
    bitRate: numberOf(fields['bitRate'], `${field}.bitRate`),
  };
}

function vorbisOf(value: unknown, field: string): VorbisEncoding {
  const fields = fieldsOf(value, field);
  if (fields['mode'] === 'quality') {
    return { mode: 'quality', quality: numberOf(fields['quality'], `${field}.quality`) };
  }
  oneOfList(fields['mode'], `${field}.mode`, ['quality', 'bit-rate'] as const);
  return {
    mode: 'bit-rate',
    nominalBitRate: numberOf(fields['nominalBitRate'], `${field}.nominalBitRate`),
  };
}

function opusOf(value: unknown, field: string): OpusEncoding {
  const fields = fieldsOf(value, field);
  return {
    bitRate: numberOf(fields['bitRate'], `${field}.bitRate`),
    application: oneOfList(fields['application'], `${field}.application`, OPUS_APPLICATIONS),
    frameDuration: oneOfList(fields['frameDuration'], `${field}.frameDuration`, OPUS_DURATIONS),
    complexity: numberOf(fields['complexity'], `${field}.complexity`),
  };
}

function aacOf(value: unknown, field: string): AacEncoding {
  return { bitRate: numberOf(fieldsOf(value, field)['bitRate'], `${field}.bitRate`) };
}

/** A format and its encoding. */
function formatEncodingOf(value: unknown, field: string): FormatEncoding {
  const fields = fieldsOf(value, field);
  const format = oneOfList(fields['format'], `${field}.format`, FORMATS);
  const encoding = fields['encoding'];
  const at = `${field}.encoding`;
  switch (format) {
    case 'wav':
      return { format, encoding: wavOf(encoding, at) };
    case 'aiff':
      return { format, encoding: integerPcmOf(fieldsOf(encoding, at), at) };
    case 'aifc':
      return { format, encoding: aifcOf(encoding, at) };
    case 'flac':
      return { format, encoding: flacOf(encoding, at) };
    case 'mp3':
      return { format, encoding: mp3Of(encoding, at) };
    case 'ogg-vorbis':
      return { format, encoding: vorbisOf(encoding, at) };
    case 'opus':
      return { format, encoding: opusOf(encoding, at) };
    case 'aac':
      return { format, encoding: aacOf(encoding, at) };
  }
}

function targetOf(value: unknown, field: string): ExportTarget {
  const fields = fieldsOf(value, field);
  const depth = fields['depth'];
  return {
    formatName: textOf(fields['formatName'], `${field}.formatName`),
    codec: codecOf(fields['codec'], `${field}.codec`),
    container: containerOf(fields['container'], `${field}.container`),
    extension: textOf(fields['extension'], `${field}.extension`),
    depth: depth === undefined ? undefined : oneOfList(depth, `${field}.depth`, INTEGER_BITS),
  };
}

function ditherOf(value: unknown, field: string): DitherSettings {
  const fields = fieldsOf(value, field);
  if (fields['kind'] === 'none') return { kind: 'none' };
  return {
    kind: oneOfList(fields['kind'], `${field}.kind`, ['rectangular', 'triangular'] as const),
    amplitude: numberOf(fields['amplitude'], `${field}.amplitude`),
    shaping: oneOfList(fields['shaping'], `${field}.shaping`, SHAPINGS),
    seed: numberOf(fields['seed'], `${field}.seed`),
  };
}

/** The encode request `value` holds, named `field`. */
export function exportEncodeRequestOf(fields: MessageFields, field: string): ExportEncodeRequest {
  const request = fieldsAt(fields, field);
  const dither = fieldsOf(request['dither'], `${field}.dither`);
  return {
    target: targetOf(request['target'], `${field}.target`),
    encoding: formatEncodingOf(request['encoding'], `${field}.encoding`),
    sampleRate: rateOf(request['sampleRate'], `${field}.sampleRate`),
    layout: layoutOf(request['layout'], `${field}.layout`),
    metadata: metadataMapOf(request['metadata'], `${field}.metadata`),
    dither: {
      settings: ditherOf(dither['settings'], `${field}.dither.settings`),
      key: numberOf(dither['key'], `${field}.dither.key`),
    },
  };
}
