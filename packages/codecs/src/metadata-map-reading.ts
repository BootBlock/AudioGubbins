/**
 * Reading a metadata map, and the parts a writer dropped, that crossed into
 * another global scope (REQ-EXEC-136.12): the codec worker sends the map it
 * read from a file to the storage worker beside the decoded audio, and the
 * parts an encoder could not write beside the encoded file.
 *
 * Each part is read field by field with the domain's message readers and
 * built again, never taken as it arrived, and every list and value is held to
 * the bounds the metadata readers keep (`metadata-limits.ts`), so a forged map
 * costs a receiver no more than one read from a file could. A text value is
 * bounded in code units at twice its bound in characters, since a character
 * is at most two.
 */

import {
  Malformed,
  boundedItemsOf,
  countOf,
  fieldsOf,
  isTagged,
  numberOf,
  oneOfValues,
  sampleCountOf,
  textOf,
} from '@audiogubbins/domain';

import {
  MAXIMUM_CUE_POINTS,
  MAXIMUM_DOCUMENT_CHARACTERS,
  MAXIMUM_LINE_CHARACTERS,
  MAXIMUM_LONG_TEXT_CHARACTERS,
  MAXIMUM_LOOPS,
  MAXIMUM_METADATA_FIELDS,
  MAXIMUM_PICTURE_BYTES,
} from './metadata-limits.js';
import type {
  BroadcastDescription,
  CoverArt,
  CuePoint,
  ForeignMetadataField,
  LoopDirection,
  MetadataLoop,
  MetadataMap,
  MetadataPart,
  MetadataTextKey,
  SamplerTuning,
} from './metadata-map.js';

/** Every typed text key, so the compiler holds that each has its place here. */
const TEXT_KEYS: Readonly<Record<MetadataTextKey, MetadataTextKey>> = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  albumArtist: 'albumArtist',
  trackNumber: 'trackNumber',
  trackTotal: 'trackTotal',
  discNumber: 'discNumber',
  discTotal: 'discTotal',
  date: 'date',
  genre: 'genre',
  comment: 'comment',
  copyright: 'copyright',
  encoder: 'encoder',
  isrc: 'isrc',
};

const DIRECTIONS: Readonly<Record<LoopDirection, LoopDirection>> = {
  forward: 'forward',
  alternating: 'alternating',
  backward: 'backward',
};

/** The parts a writer names as dropped that carry nothing but their kind. */
const BARE_PARTS = {
  broadcast: 'broadcast',
  cues: 'cues',
  loops: 'loops',
  tuning: 'tuning',
  coverArt: 'coverArt',
} as const;

/** The value, named `field`, as text of at most `characters` characters. */
function boundedTextOf(value: unknown, field: string, characters: number): string {
  const text = textOf(value, field);
  if (text.length > 2 * characters) {
    throw new Malformed(field, `text of at most ${String(characters)} characters`);
  }
  return text;
}

const lineOf = (value: unknown, field: string): string =>
  boundedTextOf(value, field, MAXIMUM_LINE_CHARACTERS);

const longTextOf = (value: unknown, field: string): string =>
  boundedTextOf(value, field, MAXIMUM_LONG_TEXT_CHARACTERS);

/** The value, named `field`, as a whole number from `low` to `high`. */
function wholeOf(value: unknown, field: string, low: number, high: number): number {
  const number = numberOf(value, field);
  if (!Number.isInteger(number) || number < low || number > high) {
    throw new Malformed(field, `a whole number from ${String(low)} to ${String(high)}`);
  }
  return number;
}

function textFieldsOf(value: unknown, field: string): Partial<Record<MetadataTextKey, string>> {
  const fields = fieldsOf(value, field);
  const text: Partial<Record<MetadataTextKey, string>> = {};
  for (const [name, one] of Object.entries(fields)) {
    const key = oneOfValues(name, `${field}.${name}`, TEXT_KEYS);
    text[key] =
      key === 'comment' ? longTextOf(one, `${field}.${key}`) : lineOf(one, `${field}.${key}`);
  }
  return text;
}

function foreignOf(value: unknown, field: string): ForeignMetadataField {
  const fields = fieldsOf(value, field);
  return {
    scheme: lineOf(fields['scheme'], `${field}.scheme`),
    key: lineOf(fields['key'], `${field}.key`),
    // A document kept whole, such as `iXML`, is the longest a foreign value holds.
    value: boundedTextOf(fields['value'], `${field}.value`, MAXIMUM_DOCUMENT_CHARACTERS),
  };
}

function broadcastOf(value: unknown, field: string): BroadcastDescription {
  const fields = fieldsOf(value, field);
  return {
    description: lineOf(fields['description'], `${field}.description`),
    originator: lineOf(fields['originator'], `${field}.originator`),
    originatorReference: lineOf(fields['originatorReference'], `${field}.originatorReference`),
    originationDate: lineOf(fields['originationDate'], `${field}.originationDate`),
    originationTime: lineOf(fields['originationTime'], `${field}.originationTime`),
    timeReference: sampleCountOf(fields['timeReference'], `${field}.timeReference`),
    codingHistory: longTextOf(fields['codingHistory'], `${field}.codingHistory`),
  };
}

function cueOf(value: unknown, field: string): CuePoint {
  const fields = fieldsOf(value, field);
  return {
    position: sampleCountOf(fields['position'], `${field}.position`),
    name: lineOf(fields['name'], `${field}.name`),
  };
}

function loopOf(value: unknown, field: string): MetadataLoop {
  const fields = fieldsOf(value, field);
  const playCount =
    fields['playCount'] === 'endless'
      ? 'endless'
      : countOf(fields['playCount'], `${field}.playCount`);
  const name = fields['name'] === undefined ? undefined : lineOf(fields['name'], `${field}.name`);
  return {
    start: sampleCountOf(fields['start'], `${field}.start`),
    length: sampleCountOf(fields['length'], `${field}.length`),
    playCount,
    direction: oneOfValues(fields['direction'], `${field}.direction`, DIRECTIONS),
    ...(name === undefined ? {} : { name }),
  };
}

function tuningOf(value: unknown, field: string): SamplerTuning {
  const fields = fieldsOf(value, field);
  const fineTuneCents = numberOf(fields['fineTuneCents'], `${field}.fineTuneCents`);
  if (fineTuneCents < -50 || fineTuneCents > 50) {
    throw new Malformed(`${field}.fineTuneCents`, 'a number from -50 to 50');
  }
  return { unityNote: wholeOf(fields['unityNote'], `${field}.unityNote`, 0, 127), fineTuneCents };
}

function coverArtOf(value: unknown, field: string): CoverArt {
  const fields = fieldsOf(value, field);
  const bytes = fields['bytes'];
  if (!isTagged(bytes, 'Uint8Array') || !ArrayBuffer.isView(bytes)) {
    throw new Malformed(`${field}.bytes`, 'bytes');
  }
  if (bytes.byteLength > MAXIMUM_PICTURE_BYTES) {
    throw new Malformed(`${field}.bytes`, `at most ${String(MAXIMUM_PICTURE_BYTES)} bytes`);
  }
  return {
    mediaType: lineOf(fields['mediaType'], `${field}.mediaType`),
    description: lineOf(fields['description'], `${field}.description`),
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  };
}

/** The map `value` holds, named `field`, read part by part within the readers' bounds. */
export function metadataMapOf(value: unknown, field: string): MetadataMap {
  const fields = fieldsOf(value, field);
  const at = (name: string) => `${field}.${name}`;
  const present = (name: string): boolean => fields[name] !== undefined;
  return {
    ...(present('text') ? { text: textFieldsOf(fields['text'], at('text')) } : {}),
    ...(present('foreign')
      ? {
          foreign: boundedItemsOf(
            fields['foreign'],
            at('foreign'),
            MAXIMUM_METADATA_FIELDS,
            foreignOf,
          ),
        }
      : {}),
    ...(present('broadcast')
      ? { broadcast: broadcastOf(fields['broadcast'], at('broadcast')) }
      : {}),
    ...(present('cues')
      ? { cues: boundedItemsOf(fields['cues'], at('cues'), MAXIMUM_CUE_POINTS, cueOf) }
      : {}),
    ...(present('loops')
      ? { loops: boundedItemsOf(fields['loops'], at('loops'), MAXIMUM_LOOPS, loopOf) }
      : {}),
    ...(present('tuning') ? { tuning: tuningOf(fields['tuning'], at('tuning')) } : {}),
    ...(present('coverArt') ? { coverArt: coverArtOf(fields['coverArt'], at('coverArt')) } : {}),
  };
}

/** A part of a map a writer dropped, named `field`. */
export function metadataPartOf(value: unknown, field: string): MetadataPart {
  const fields = fieldsOf(value, field);
  switch (fields['kind']) {
    case 'text':
      return { kind: 'text', key: oneOfValues(fields['key'], `${field}.key`, TEXT_KEYS) };
    case 'foreign':
      return {
        kind: 'foreign',
        scheme: lineOf(fields['scheme'], `${field}.scheme`),
        key: lineOf(fields['key'], `${field}.key`),
      };
    default:
      return { kind: oneOfValues(fields['kind'], `${field}.kind`, BARE_PARTS) };
  }
}
