/**
 * What the Export dialog says of settings (ADR-0092): each value as a person
 * reads it, what a preset sets, and the sentence saying what an export will
 * do before it is started. Words only: whether settings can be made is the
 * import-export package's to say, and its reasons are shown as it gives them.
 */

import type { MetadataTextKey } from '@audiogubbins/codecs';
import { channelCount } from '@audiogubbins/domain';
import {
  formatName,
  type ChannelConversion,
  type CollisionPolicy,
  type DitherSettings,
  type ExportFormat,
  type ExportPreset,
  type ExportRange,
  type ExportSettings,
  type FormatEncoding,
  type MetadataPolicy,
  type NoiseShaping,
  type PlannedFile,
} from '@audiogubbins/import-export';
import { counted, quoted } from '@audiogubbins/text';

import { suggestedName } from '../../export/destination-choice.js';
import type { ExportDestinationDraft } from '../../state/export-dialog-store.js';
import type { PresetSettings } from '../../state/stored-export-presets.js';
import { sampleRateWords } from '../../wording.js';

/** The formats, in the order the dialog lists them: uncompressed, lossless, then lossy. */
export const FORMAT_ORDER: readonly ExportFormat[] = [
  'wav',
  'aiff',
  'aifc',
  'flac',
  'mp3',
  'ogg-vorbis',
  'opus',
  'aac',
];

/** The coded encodings, by the name each goes by. */
const CODED_NAMES = {
  'a-law': 'A-law',
  'mu-law': 'µ-law',
  'ima-adpcm': 'IMA ADPCM',
  'ms-adpcm': 'Microsoft ADPCM',
} as const;

/** PCM of WAV, AIFF or AIFF-C: its depth and kind, or the code it is in. */
function pcmWords(
  encoding:
    | { readonly kind: 'integer' | 'float'; readonly bits: number }
    | {
        readonly kind: keyof typeof CODED_NAMES;
      },
): string {
  switch (encoding.kind) {
    case 'integer':
      return `${String(encoding.bits)}-bit integer`;
    case 'float':
      return `${String(encoding.bits)}-bit float`;
    default:
      return CODED_NAMES[encoding.kind];
  }
}

/** The encoding of a format, as a person reads it after the format's name. */
function encodingOnly(settings: FormatEncoding): string {
  switch (settings.format) {
    case 'wav':
    case 'aiff':
    case 'aifc':
      return pcmWords(settings.encoding);
    case 'flac':
      return `${String(settings.encoding.bits)}-bit, compression level ${String(settings.encoding.compressionLevel)}`;
    case 'mp3': {
      const { encoding } = settings;
      if (encoding.mode === 'variable')
        return `variable bit rate, quality V${String(encoding.quality)}`;
      return `${encoding.mode === 'constant' ? 'constant' : 'average'} ${String(encoding.bitRate)} kbit/s`;
    }
    case 'ogg-vorbis':
      return settings.encoding.mode === 'quality'
        ? `quality ${String(settings.encoding.quality)}`
        : `nominal ${String(settings.encoding.nominalBitRate)} kbit/s`;
    case 'opus': {
      const { bitRate, application, frameDuration, complexity } = settings.encoding;
      return `${String(bitRate)} kbit/s, tuned for ${APPLICATION_NAMES[application]}, ${String(frameDuration)} ms frames, complexity ${String(complexity)}`;
    }
    case 'aac':
      return `${String(settings.encoding.bitRate)} kbit/s`;
  }
}

/** What Opus is tuned for, as a person reads it. */
export const APPLICATION_NAMES = {
  audio: 'music and effects',
  voip: 'speech',
  'restricted-low-delay': 'the lowest delay',
} as const;

/** A format and its encoding: "FLAC, 24-bit, compression level 8". */
export function encodingWords(settings: FormatEncoding): string {
  return `${formatName(settings.format)}, ${encodingOnly(settings)}`;
}

/** The standard layouts the dialog folds to, with what each is called. */
export const LAYOUT_NAMES = {
  mono: 'mono',
  stereo: 'stereo',
  lcr: 'left, centre and right',
  quadraphonic: 'quadraphonic',
  surround5_1: '5.1 surround',
  surround7_1: '7.1 surround',
  surround7_1_4: '7.1.4 surround',
} as const;

/** The named matrices, by what each does. */
export const MATRIX_NAMES = {
  'itu-bs775-5.1-to-stereo': '5.1 folded to stereo (ITU-R BS.775)',
  'mid-side-encode': 'stereo to mid and side',
  'mid-side-decode': 'mid and side to stereo',
} as const;

/** What a channel conversion does, as a person reads it. */
export function conversionWords(conversion: ChannelConversion): string {
  switch (conversion.kind) {
    case 'keep':
      return 'the channels kept as they are';
    case 'fold':
      return `folded to ${counted(channelCount(conversion.to), 'channel', 'channels')}`;
    case 'matrix':
      return MATRIX_NAMES[conversion.matrix];
    case 'map':
      return `channels ${conversion.channels.map((index) => String(index + 1)).join(', ')} taken in that order`;
  }
}

/** Each noise shaping, by what it is. */
export const SHAPING_NAMES: Readonly<Record<NoiseShaping, string>> = {
  none: 'no shaping',
  'first-order': 'first-order shaping',
  'lipshitz-e-weighted': 'E-weighted shaping (44.1 kHz)',
};

/** What a dither adds, as a person reads it. */
export function ditherWords(dither: DitherSettings): string {
  if (dither.kind === 'none') return 'no dither';
  return `${dither.kind} dither of ${String(dither.amplitude)} ${dither.amplitude === 1 ? 'step' : 'steps'}, ${SHAPING_NAMES[dither.shaping]}`;
}

/** What each metadata policy carries. */
export const METADATA_POLICY_WORDS: Readonly<Record<MetadataPolicy, string>> = {
  full: 'The project’s metadata, with the region’s over it, as far as the format holds it',
  minimal: 'The title and the loops alone',
  none: 'No metadata at all',
};

/** Each metadata field, by the name it goes by. */
export const METADATA_FIELD_NAMES: Readonly<Record<MetadataTextKey, string>> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
  trackNumber: 'Track number',
  trackTotal: 'Track total',
  discNumber: 'Disc number',
  discTotal: 'Disc total',
  date: 'Date',
  genre: 'Genre',
  comment: 'Comment',
  copyright: 'Copyright',
  encoder: 'Encoder',
  isrc: 'ISRC',
};

/** What each collision policy does with a name taken, as the end of a sentence. */
export const POLICY_WORDS: Readonly<Record<CollisionPolicy, string>> = {
  prompt: 'you are asked what to do with a file whose name is taken',
  overwrite: 'a file whose name is taken is replaced',
  skip: 'a file whose name is taken is left, and its export skipped',
  rename: 'a file whose name is taken is kept, and the export named “name (2)” and on',
};

/** What a range covers, as a person reads it. */
export function rangeWords(range: ExportRange, regionName: (id: string) => string): string {
  switch (range.kind) {
    case 'project':
      return 'the whole asset';
    case 'region':
      return `the region ${quoted(regionName(range.region))}`;
    case 'every-region':
      return 'every region, a file each';
    case 'selection':
      return 'the selection';
  }
}

/**
 * What a preset of AudioGubbins sets, in a sentence: the values it chooses,
 * read from `resolved`, the settings it gives, and that the rest are the
 * highest quality for the asset.
 */
export function presetSentence(preset: ExportPreset, resolved: ExportSettings): string {
  const { settings } = preset;
  const parts = [
    settings.encoding === undefined
      ? `${formatName(preset.format)} at its highest quality`
      : encodingWords(resolved),
    ...(settings.sampleRate === undefined ? [] : [`at ${sampleRateWords(resolved.sampleRate)}`]),
    ...(settings.channels === undefined ? [] : [conversionWords(resolved.channels)]),
    ...(settings.dither === undefined ? [] : [ditherWords(resolved.dither)]),
  ];
  return `Sets ${parts.join(', ')}; everything else is the highest quality for this asset.`;
}

/** What a preset of the person's sets: every value it was saved with. */
export function ownPresetSentence(settings: PresetSettings): string {
  return `Sets ${encodingWords(settings)} at ${sampleRateWords(settings.sampleRate)}, ${conversionWords(settings.channels)}, ${ditherWords(settings.dither)}, named ${quoted(settings.fileName)}.`;
}

/** Where the files go, as the end of a sentence. */
function destinationWords(
  destination: ExportDestinationDraft,
  trustedName: (key: string) => string | undefined,
): string {
  switch (destination.kind) {
    case 'file':
      return 'to a file you name in a save dialog as the export starts';
    case 'download':
      return 'as a download, since this browser gives no save dialog';
    case 'folder':
      return `into a folder you choose as the export starts, where ${POLICY_WORDS[destination.policy]}`;
    case 'trusted-folder': {
      const name = trustedName(destination.key);
      const folder = name === undefined ? 'a folder no longer kept trusted' : quoted(name);
      return `into ${folder}, kept trusted, where a file AudioGubbins exported there and unchanged since is replaced without asking, and otherwise ${POLICY_WORDS[destination.policy]}`;
    }
  }
}

/**
 * What starting the export will do, in a sentence: the files it makes, how
 * they are encoded, and where they go.
 */
export function whatWillHappen(
  settings: ExportSettings,
  files: readonly PlannedFile[],
  destination: ExportDestinationDraft,
  trustedName: (key: string) => string | undefined,
): string {
  const [first] = files;
  const named = first === undefined ? '' : quoted(suggestedName(first));
  const made =
    files.length === 1
      ? `one file, ${named}`
      : `${counted(files.length, 'file', 'files')}, the first ${named}`;
  return `Exports ${made}: ${encodingWords(settings)} at ${sampleRateWords(settings.sampleRate)}, ${conversionWords(settings.channels)}, with ${ditherWords(settings.dither)}, ${destinationWords(destination, trustedName)}.`;
}
