/**
 * What a file is, as its contents say, and the sentence that names it.
 *
 * Recognition names the formats this package cannot read as well as those it
 * can, because REQ-AUDIO-220 refuses an unreadable file with a sentence naming
 * what it is: a person told "this is FLAC" knows what to convert, where one
 * told only "unsupported" does not.
 */

/** The containers this package reads. */
export type ReadableContainer = 'wav' | 'rf64' | 'bw64' | 'aiff' | 'aifc';

/** The RIFF forms, which share one format chunk and one walk. */
export type RiffContainer = 'wav' | 'rf64' | 'bw64';

/** A file in a container whose samples this package reads. */
export interface ReadableFormat {
  readonly kind: ReadableContainer;
}

/** A file in a format of its own that this package does not read. */
export interface ForeignFormat {
  readonly kind: 'flac' | 'mp3' | 'ogg' | 'mp4';
}

/**
 * A RIFF file whose samples are compressed. `formatTag` is the format code,
 * from the extensible sub-format where the file uses one; `subFormat` is the
 * whole sub-format identifier where it is not one of the standard codes.
 */
export interface CompressedWaveFormat {
  readonly kind: 'compressed-wav';
  readonly container: RiffContainer;
  readonly formatTag: number;
  readonly subFormat?: string;
}

/** An AIFF-C file whose compression type is not one of the uncompressed ones. */
export interface CompressedAifcFormat {
  readonly kind: 'compressed-aifc';
  readonly compressionType: string;
}

/** A file whose contents name no format this package knows. */
export interface UnknownFormat {
  readonly kind: 'unknown';
}

/** What a file is, as its contents say. */
export type RecognisedFormat =
  ReadableFormat | ForeignFormat | CompressedWaveFormat | CompressedAifcFormat | UnknownFormat;

/** The formats a refusal tells the person can be read. */
export const READABLE_FORMATS_SENTENCE =
  'AudioGubbins reads WAV (including RF64 and BW64), AIFF and uncompressed AIFF-C.';

/** The common WAV compression codes, by the names their documentation gives them. */
const WAVE_CODEC_NAMES: ReadonlyMap<number, string> = new Map([
  [0x0002, 'Microsoft ADPCM'],
  [0x0006, 'A-law'],
  [0x0007, 'µ-law'],
  [0x0011, 'IMA ADPCM'],
  [0x0050, 'MPEG'],
  [0x0055, 'MPEG Layer III'],
]);

/** The common AIFF-C compression types, by the names their documentation gives them. */
const AIFC_CODEC_NAMES: ReadonlyMap<string, string> = new Map([
  ['ulaw', 'µ-law'],
  ['alaw', 'A-law'],
  ['ima4', 'IMA 4:1 ADPCM'],
  ['MAC3', 'MACE 3:1'],
  ['MAC6', 'MACE 6:1'],
  ['GSM ', 'GSM'],
]);

const CONTAINER_NAMES: Readonly<Record<RiffContainer, string>> = {
  wav: 'WAV',
  rf64: 'RF64',
  bw64: 'BW64',
};

const FOREIGN_NAMES: Readonly<Record<ForeignFormat['kind'], string>> = {
  flac: 'FLAC audio',
  mp3: 'MP3 audio',
  ogg: 'Ogg audio',
  mp4: 'MPEG-4 audio, such as M4A or AAC',
};

/** A format code as its documentation writes it, four hexadecimal digits. */
export function hexCode(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Printable ASCII, the only characters a four-character code is quoted with. */
const PRINTABLE_CODE = /^[\x20-\x7E]{4}$/u;

/**
 * A four-character code as a sentence can quote it: as its characters where
 * they are printable, and otherwise as the hexadecimal of its four bytes, so a
 * corrupt code puts no control character into a message.
 */
export function quotedCode(code: string): string {
  if (PRINTABLE_CODE.test(code)) return `'${code}'`;
  const bytes = Array.from(code, (character) =>
    character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
  return `0x${bytes.join('')}`;
}

/**
 * The sentence naming a format this package does not read, without the list of
 * the formats it does.
 */
export function formatSentence(format: Exclude<RecognisedFormat, ReadableFormat>): string {
  switch (format.kind) {
    case 'compressed-wav': {
      const codec =
        format.subFormat === undefined
          ? (WAVE_CODEC_NAMES.get(format.formatTag) ?? `code ${hexCode(format.formatTag)}`)
          : `sub-format ${format.subFormat}`;
      return `This file is ${CONTAINER_NAMES[format.container]} audio compressed as ${codec}.`;
    }
    case 'compressed-aifc': {
      const codec =
        AIFC_CODEC_NAMES.get(format.compressionType) ??
        `type ${quotedCode(format.compressionType)}`;
      return `This file is AIFF-C audio compressed as ${codec}.`;
    }
    case 'unknown':
      return 'This file is not in an audio format AudioGubbins recognises.';
    default:
      return `This file is ${FOREIGN_NAMES[format.kind]}.`;
  }
}
