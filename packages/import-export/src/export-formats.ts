/**
 * What each format is made of: its name, its container, its file extension,
 * the codec each of its encodings is written by, and the integer depth its
 * samples are quantised to, if any.
 *
 * One table, so a new format is a new row, never another arm of a switch
 * spread across the package.
 */

import type { ChannelLayout } from '@audiogubbins/domain';
import { writtenChannelOrder, type CodecId, type ContainerId } from '@audiogubbins/codecs';

import type { CodecLookup } from './export-context.js';
import type {
  CodedPcm,
  ExportFormat,
  FloatPcm,
  FormatEncoding,
  FormatEncodingOf,
  FormatEncodings,
  IntegerPcm,
} from './export-settings.js';

/** One format's row. */
interface FormatRow<F extends ExportFormat> {
  /** The format's name as a sentence gives it. */
  readonly name: string;
  readonly container: ContainerId;

  /** The extension its files are named with, without the dot. */
  readonly extension: string;
  readonly codecOf: (encoding: FormatEncodings[F]) => CodecId;

  /**
   * The codec whose statement of a channel layout its files make. Every
   * encoding of a WAV or AIFF file states a layout alike, by its container.
   */
  readonly layoutCodec: CodecId;

  /**
   * The integer depth the encoder takes its samples at, which dither is added
   * before, or `undefined` where it takes floating point.
   */
  readonly depthOf: (encoding: FormatEncodings[F]) => number | undefined;
}

/** The code each coded encoding is written in. */
const CODED: Readonly<Record<CodedPcm['kind'], CodecId>> = {
  'a-law': 'g711-alaw',
  'mu-law': 'g711-ulaw',
  'ima-adpcm': 'ima-adpcm',
  'ms-adpcm': 'ms-adpcm',
};

/**
 * G.711 and both ADPCM codes are defined over 16-bit linear samples, so those
 * are what the dither and quantisation make before the code is applied.
 */
const CODED_INPUT_BITS = 16;

function pcmCodec(encoding: IntegerPcm | FloatPcm | CodedPcm): CodecId {
  return encoding.kind === 'integer' || encoding.kind === 'float' ? 'pcm' : CODED[encoding.kind];
}

function pcmDepth(encoding: IntegerPcm | FloatPcm | CodedPcm): number | undefined {
  switch (encoding.kind) {
    case 'integer':
      return encoding.bits;
    case 'float':
      return undefined;
    default:
      return CODED_INPUT_BITS;
  }
}

const FLOATING = (): undefined => undefined;

const FORMATS: { readonly [F in ExportFormat]: FormatRow<F> } = {
  wav: {
    name: 'WAV',
    container: 'wav',
    extension: 'wav',
    codecOf: pcmCodec,
    layoutCodec: 'pcm',
    depthOf: pcmDepth,
  },
  aiff: {
    name: 'AIFF',
    container: 'aiff',
    extension: 'aiff',
    codecOf: pcmCodec,
    layoutCodec: 'pcm',
    depthOf: pcmDepth,
  },
  aifc: {
    name: 'AIFF-C',
    container: 'aifc',
    extension: 'aifc',
    codecOf: pcmCodec,
    layoutCodec: 'pcm',
    depthOf: pcmDepth,
  },
  flac: {
    name: 'FLAC',
    container: 'flac',
    extension: 'flac',
    codecOf: () => 'flac',
    layoutCodec: 'flac',
    depthOf: (encoding) => encoding.bits,
  },
  mp3: {
    name: 'MP3',
    container: 'mp3',
    extension: 'mp3',
    codecOf: () => 'mp3',
    layoutCodec: 'mp3',
    depthOf: FLOATING,
  },
  'ogg-vorbis': {
    name: 'Ogg Vorbis',
    container: 'ogg',
    extension: 'ogg',
    codecOf: () => 'vorbis',
    layoutCodec: 'vorbis',
    depthOf: FLOATING,
  },
  opus: {
    name: 'Opus',
    container: 'ogg',
    extension: 'opus',
    codecOf: () => 'opus',
    layoutCodec: 'opus',
    depthOf: FLOATING,
  },
  aac: {
    name: 'AAC',
    container: 'mp4',
    extension: 'm4a',
    codecOf: () => 'aac-lc',
    layoutCodec: 'aac-lc',
    depthOf: FLOATING,
  },
};

/** What one export's file is: its format's row, read for its encoding. */
export interface ExportTarget {
  readonly formatName: string;
  readonly codec: CodecId;
  readonly container: ContainerId;
  readonly extension: string;

  /** The integer depth samples are quantised to, or `undefined` for floating point. */
  readonly depth: number | undefined;
}

function targetOfFormat<F extends ExportFormat>(settings: FormatEncodingOf<F>): ExportTarget {
  const row: FormatRow<F> = FORMATS[settings.format];
  return {
    formatName: row.name,
    codec: row.codecOf(settings.encoding),
    container: row.container,
    extension: row.extension,
    depth: row.depthOf(settings.encoding),
  };
}

/** The file an export's format and encoding make, as its settings state them. */
export function exportTarget(settings: FormatEncoding): ExportTarget {
  return targetOfFormat(settings);
}

/**
 * The names of the formats whose files state `layout` and whose codec writes
 * as many channels, in the table's order (ADR-0093).
 */
export function formatsStating(layout: ChannelLayout, codecs: CodecLookup): readonly string[] {
  return Object.values(FORMATS)
    .filter(
      (row) =>
        (codecs(row.layoutCodec)?.write?.maximumChannels ?? 0) >= layout.roles.length &&
        writtenChannelOrder(row.layoutCodec, row.container, layout).ok,
    )
    .map((row) => row.name);
}

/** A format's name as a sentence gives it. */
export function formatName(format: ExportFormat): string {
  return FORMATS[format].name;
}
