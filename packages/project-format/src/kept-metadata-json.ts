/**
 * Writing and reading a file's metadata as provenance keeps it
 * (`kept-metadata.ts`, ADR-0093, REQ-EXEC-136.12).
 *
 * Every member is read by its own rule, and every value is the file's
 * untrusted text, bounded by what the codecs' readers could have read: no
 * value is longer than a file's metadata may be, and no list longer than a
 * document's. A position or a length is a count of the file's frames.
 */

import type {
  BroadcastDescription,
  CuePoint,
  ForeignMetadataField,
  LoopDirection,
  MetadataLoop,
  MetadataTextKey,
  SamplerTuning,
} from '@audiogubbins/codecs';

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import {
  MAXIMUM_KEPT_FOREIGN_FIELDS,
  type KeptCoverArt,
  type KeptMetadata,
} from './kept-metadata.js';
import {
  integerConverter,
  namedValueConverter,
  numberConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';
import {
  MAXIMUM_NESTED_ITEMS,
  asMediaType,
  asSampleCount,
  asWholeQuantity,
} from './value-reading.js';

/** The text fields with a meaning every format maps, each once. */
const TEXT_KEYS = {
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
} as const satisfies Readonly<Record<MetadataTextKey, true>>;

const TEXT_KEY_SET: ReadonlySet<string> = new Set(Object.keys(TEXT_KEYS));

function isTextKey(name: string): name is MetadataTextKey {
  return TEXT_KEY_SET.has(name);
}

const asDirection = namedValueConverter<LoopDirection>({
  forward: true,
  alternating: true,
  backward: true,
});

/**
 * The longest value: the most bytes of metadata the codecs read from one file,
 * each of which decodes to one character at most.
 */
const LONGEST_VALUE = 8 * 1_048_576;

/** The longest key of a foreign field or the name of its scheme. */
const LONGEST_KEY = 1_024;

const METADATA_MEMBERS: ReadonlySet<string> = new Set([
  'text',
  'foreign',
  'broadcast',
  'cues',
  'loops',
  'tuning',
  'coverArt',
]);
const FOREIGN_MEMBERS: ReadonlySet<string> = new Set(['scheme', 'key', 'value']);
const BROADCAST_MEMBERS: ReadonlySet<string> = new Set([
  'description',
  'originator',
  'originatorReference',
  'originationDate',
  'originationTime',
  'timeReference',
  'codingHistory',
]);
const CUE_MEMBERS: ReadonlySet<string> = new Set(['position', 'name']);
const LOOP_MEMBERS: ReadonlySet<string> = new Set([
  'start',
  'length',
  'playCount',
  'direction',
  'name',
]);
const TUNING_MEMBERS: ReadonlySet<string> = new Set(['unityNote', 'fineTuneCents']);
const COVER_MEMBERS: ReadonlySet<string> = new Set(['mediaType', 'description', 'byteLength']);

const asValue = textConverter({ maximumLength: LONGEST_VALUE });
const asForeignKey = textConverter({ maximumLength: LONGEST_KEY });
const asNote = integerConverter(0, 127);
const asCents = numberConverter(-50, 50);
const asPlays = integerConverter(0, Number.MAX_SAFE_INTEGER);
const asEndless = oneOfConverter(['endless'] as const);

/** The text fields, by their typed key. */
const asText: Converter<Readonly<Partial<Record<MetadataTextKey, string>>>> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, TEXT_KEY_SET);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const text: Partial<Record<MetadataTextKey, string>> = {};
  for (const name of Object.keys(object)) {
    if (!isTextKey(name)) continue;
    const read = optional(reading, object, at, name, asValue);
    if (read !== undefined) text[name] = read;
  }
  return text;
};

const asForeign: Converter<ForeignMetadataField> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, FOREIGN_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const scheme = required(reading, object, at, 'scheme', asForeignKey);
  const name = required(reading, object, at, 'key', asForeignKey);
  const text = required(reading, object, at, 'value', asValue);
  return scheme === undefined || name === undefined || text === undefined
    ? undefined
    : { scheme, key: name, value: text };
};

const asBroadcast: Converter<BroadcastDescription> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, BROADCAST_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const description = required(reading, object, at, 'description', asValue);
  const originator = required(reading, object, at, 'originator', asValue);
  const originatorReference = required(reading, object, at, 'originatorReference', asValue);
  const originationDate = required(reading, object, at, 'originationDate', asValue);
  const originationTime = required(reading, object, at, 'originationTime', asValue);
  const timeReference = required(reading, object, at, 'timeReference', asSampleCount);
  const codingHistory = required(reading, object, at, 'codingHistory', asValue);
  if (
    description === undefined ||
    originator === undefined ||
    originatorReference === undefined ||
    originationDate === undefined ||
    originationTime === undefined ||
    timeReference === undefined ||
    codingHistory === undefined
  ) {
    return undefined;
  }
  return {
    description,
    originator,
    originatorReference,
    originationDate,
    originationTime,
    timeReference,
    codingHistory,
  };
};

const asCue: Converter<CuePoint> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CUE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const position = required(reading, object, at, 'position', asSampleCount);
  const name = required(reading, object, at, 'name', asValue);
  return position === undefined || name === undefined ? undefined : { position, name };
};

/** How many times a loop plays: a count, or `endless`. */
const asPlayCount: Converter<number | 'endless'> = (reading, value, parent, key) =>
  typeof value === 'number'
    ? asPlays(reading, value, parent, key)
    : asEndless(reading, value, parent, key);

const asLoop: Converter<MetadataLoop> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LOOP_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const start = required(reading, object, at, 'start', asSampleCount);
  const length = required(reading, object, at, 'length', asSampleCount);
  const playCount = required(reading, object, at, 'playCount', asPlayCount);
  const direction = required(reading, object, at, 'direction', asDirection);
  const name = optional(reading, object, at, 'name', asValue);
  if (
    start === undefined ||
    length === undefined ||
    playCount === undefined ||
    direction === undefined
  ) {
    return undefined;
  }
  return { start, length, playCount, direction, ...(name === undefined ? {} : { name }) };
};

const asTuning: Converter<SamplerTuning> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, TUNING_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const unityNote = required(reading, object, at, 'unityNote', asNote);
  const fineTuneCents = required(reading, object, at, 'fineTuneCents', asCents);
  return unityNote === undefined || fineTuneCents === undefined
    ? undefined
    : { unityNote, fineTuneCents };
};

const asCoverArt: Converter<KeptCoverArt> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, COVER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const mediaType = required(reading, object, at, 'mediaType', asMediaType);
  const description = required(reading, object, at, 'description', asValue);
  const byteLength = required(reading, object, at, 'byteLength', asWholeQuantity);
  return mediaType === undefined || description === undefined || byteLength === undefined
    ? undefined
    : { mediaType, description, byteLength };
};

const asForeignList = listConverter(MAXIMUM_KEPT_FOREIGN_FIELDS, asForeign);
const asCues = listConverter(MAXIMUM_NESTED_ITEMS, asCue);
const asLoops = listConverter(MAXIMUM_NESTED_ITEMS, asLoop);

/** Reads a file's metadata as provenance keeps it. */
export const readKeptMetadata: Converter<KeptMetadata> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, METADATA_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const parts = {
    text: optional(reading, object, at, 'text', asText),
    foreign: optional(reading, object, at, 'foreign', asForeignList),
    broadcast: optional(reading, object, at, 'broadcast', asBroadcast),
    cues: optional(reading, object, at, 'cues', asCues),
    loops: optional(reading, object, at, 'loops', asLoops),
    tuning: optional(reading, object, at, 'tuning', asTuning),
    coverArt: optional(reading, object, at, 'coverArt', asCoverArt),
  };
  const kept: { -readonly [K in keyof KeptMetadata]: KeptMetadata[K] } = {};
  if (parts.text !== undefined) kept.text = parts.text;
  if (parts.foreign !== undefined) kept.foreign = parts.foreign;
  if (parts.broadcast !== undefined) kept.broadcast = parts.broadcast;
  if (parts.cues !== undefined) kept.cues = parts.cues;
  if (parts.loops !== undefined) kept.loops = parts.loops;
  if (parts.tuning !== undefined) kept.tuning = parts.tuning;
  if (parts.coverArt !== undefined) kept.coverArt = parts.coverArt;
  return kept;
};

/** Writes a file's metadata as provenance keeps it. */
export function writeKeptMetadata(metadata: KeptMetadata): JsonObject {
  const text = metadata.text;
  return presentMembers({
    text: text === undefined ? undefined : presentMembers({ ...text }),
    foreign: metadata.foreign?.map((field) => ({ ...field })),
    broadcast: metadata.broadcast === undefined ? undefined : { ...metadata.broadcast },
    cues: metadata.cues?.map((cue) => ({ position: cue.position, name: cue.name })),
    loops: metadata.loops?.map(writeLoop),
    tuning: metadata.tuning === undefined ? undefined : { ...metadata.tuning },
    coverArt: metadata.coverArt === undefined ? undefined : { ...metadata.coverArt },
  });
}

function writeLoop(loop: MetadataLoop): JsonValue {
  return presentMembers({
    start: loop.start,
    length: loop.length,
    playCount: loop.playCount,
    direction: loop.direction,
    name: loop.name,
  });
}
