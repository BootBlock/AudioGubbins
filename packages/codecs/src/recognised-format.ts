/**
 * What a file is, as its contents say, and the sentence that names it.
 *
 * Recognition names every container it finds and the codec where the bytes it
 * reads state one, including those no implementation serves, because a refused
 * file is refused with a sentence naming what it is (REQ-AUDIO-220): a person
 * told "this is Speex in Ogg" knows what to convert, where one told only
 * "unsupported" does not. Whether a file is read in place, decoded or refused
 * is the registry's answer, asked by the import route, never decided here.
 */

import type { CodecId, ContainerId } from './codec-descriptor.js';
import { codecDescriptor } from './codec-registry.js';

/** The containers this package reads samples from in place. */
export type ReadableContainer = 'wav' | 'rf64' | 'bw64' | 'aiff' | 'aifc';

/** The RIFF forms, which share one format chunk and one walk. */
export type RiffContainer = 'wav' | 'rf64' | 'bw64';

/** A codec, as a file's contents state it. */
export type StatedCodec =
  /** A codec the registry names. */
  | { readonly kind: 'named'; readonly codec: CodecId }
  /** The container names its codec only past the bytes recognition reads, as MP4 and Matroska do. */
  | { readonly kind: 'unstated' }
  /** A code no descriptor covers, by the name its documentation gives it, or its code. */
  | { readonly kind: 'unnamed'; readonly description: string };

/** What a file is, as its contents say. */
export type RecognisedFormat =
  | { readonly kind: 'audio'; readonly container: ContainerId; readonly codec: StatedCodec }
  | { readonly kind: 'unknown' };

/** The format of a file whose container states a codec the registry names. */
export function namedFormat(container: ContainerId, codec: CodecId): RecognisedFormat {
  return { kind: 'audio', container, codec: { kind: 'named', codec } };
}

/** The format of a file whose container states a code no descriptor covers. */
export function unnamedFormat(container: ContainerId, description: string): RecognisedFormat {
  return { kind: 'audio', container, codec: { kind: 'unnamed', description } };
}

/** Each container as a sentence names it. */
const CONTAINER_NAMES: Readonly<Record<ContainerId, string>> = {
  wav: 'WAV',
  rf64: 'RF64',
  bw64: 'BW64',
  aiff: 'AIFF',
  aifc: 'AIFF-C',
  flac: 'FLAC',
  mp3: 'MPEG',
  ogg: 'Ogg',
  mp4: 'MPEG-4',
  adts: 'ADTS',
  webm: 'WebM',
  matroska: 'Matroska',
};

/** A container's name as a sentence gives it. */
export function containerName(container: ContainerId): string {
  return CONTAINER_NAMES[container];
}

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

/** The sentence naming what a file is, without what can be done with it. */
export function formatSentence(format: RecognisedFormat): string {
  if (format.kind === 'unknown') {
    return 'This file is not in an audio format AudioGubbins recognises.';
  }
  const container = CONTAINER_NAMES[format.container];
  switch (format.codec.kind) {
    case 'named':
      return `This file is ${container} audio encoded as ${codecDescriptor(format.codec.codec).name}.`;
    case 'unnamed':
      return `This file is ${container} audio compressed as ${format.codec.description}.`;
    case 'unstated':
      return `This file is ${container} audio.`;
  }
}
