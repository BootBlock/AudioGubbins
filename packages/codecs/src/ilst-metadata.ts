/**
 * MP4 metadata as iTunes lays it out: the items of the `ilst` box (ADR-0093).
 *
 * Each item is a box named for its field holding a `data` box, whose type
 * says how its value is coded: UTF-8 text, a JPEG or PNG picture, or bytes.
 * The map's text is written in the items players read (`©nam`, `©ART`,
 * `©alb`, `aART`, `©day`, `©gen`, `©cmt`, `cprt`, `©too`), the track and disc
 * numbers in the binary `trkn` and `disk` items, which hold numbers alone, and
 * the cover in `covr`, which holds no description. Free-form `----` items,
 * named by a `mean` and a `name`, carry the ISRC, the loop as `LOOPSTART` and
 * `LOOPLENGTH`, the gapless playback information `iTunSMPB` the writer adds,
 * and foreign fields.
 *
 * Foreign fields are keyed by the item's type for a text item no mapping names,
 * by the name for a free-form item of iTunes's `com.apple.iTunes` mean whose
 * name is not four characters, and as `----:mean:name` otherwise, so each key
 * says how it is written back. `iTunSMPB` is the stream's own statement of its
 * priming and padding, not the person's metadata, so it is not kept in a map.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode, viewOf } from './byte-reading.js';
import { ByteWriter } from './byte-writer.js';
import { malformed } from './codec-failures.js';
import { metadataOverBound } from './framing-failures.js';
import { id3Genre } from './id3-genres.js';
import { LOOP_LENGTH_TAG, LOOP_START_TAG, loopTagPart, taggedLoop } from './loop-tags.js';
import type { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_PICTURE_BYTES, MAXIMUM_TEXT_BYTES } from './metadata-limits.js';
import type { MetadataMap, MetadataPart, MetadataTextKey } from './metadata-map.js';
import { ALL_TEXT_KEYS, partsNotHeld, textEntries } from './metadata-parts.js';
import { box, fullBox } from './mp4-box.js';
import { decodeUtf8, encodeLatin1, encodeUtf8 } from './metadata-text.js';

/** The scheme a foreign item is kept under. */
const ILST_SCHEME = 'ilst';

/** iTunes's mean for its free-form items. */
const ITUNES_MEAN = 'com.apple.iTunes';

/** The free-form name of the gapless playback information. */
const GAPLESS_NAME = 'iTunSMPB';

/** The text items, by the key each holds. */
const TEXT_ITEMS: Readonly<Partial<Record<MetadataTextKey, string>>> = {
  title: '©nam',
  artist: '©ART',
  album: '©alb',
  albumArtist: 'aART',
  date: '©day',
  genre: '©gen',
  comment: '©cmt',
  copyright: 'cprt',
  encoder: '©too',
};

const KEY_OF_ITEM: ReadonlyMap<string, MetadataTextKey> = new Map(
  [...ALL_TEXT_KEYS].flatMap((key) => {
    const item = TEXT_ITEMS[key];
    return item === undefined ? [] : [[item, key] as const];
  }),
);

/** The `data` box's type codes. */
const DataType = { Binary: 0, Utf8: 1, Jpeg: 13, Png: 14, Bmp: 27 } as const;

const PICTURE_TYPES: ReadonlyMap<string, number> = new Map([
  ['image/jpeg', DataType.Jpeg],
  ['image/png', DataType.Png],
  ['image/bmp', DataType.Bmp],
]);

const PICTURE_MEDIA: ReadonlyMap<number, string> = new Map(
  [...PICTURE_TYPES].map(([media, type]) => [type, media] as const),
);

/** A whole number a `trkn` or `disk` item holds: digits, at most 65,535. */
const ITEM_NUMBER = /^\d{1,5}$/;

const itemNumber = (value: string | undefined): number | undefined =>
  value !== undefined && ITEM_NUMBER.test(value) && Number(value) <= 0xffff
    ? Number(value)
    : undefined;

/** The free-form names the writer writes itself, which a foreign field may not take. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'ISRC',
  GAPLESS_NAME.toUpperCase(),
  'LOOPSTART',
  'LOOPLENGTH',
  'LOOPEND',
  'LOOP_START',
  'LOOP_LENGTH',
  'LOOP_END',
]);

/** A free-form foreign key of an explicit mean: `----:mean:name`. */
const FREE_FORM_KEY = /^----:([^:]+):(.+)$/;

const dataBox = (type: number, value: Uint8Array): Uint8Array =>
  box('data', new ByteWriter().u32(type).u32(0).toBytes(), value);

const textItem = (item: string, value: string): Uint8Array =>
  box(item, dataBox(DataType.Utf8, encodeUtf8(value)));

/** A free-form item of `mean` and `name` holding text. */
function freeFormItem(mean: string, name: string, value: string): Uint8Array {
  return box(
    '----',
    fullBox('mean', 0, 0, encodeUtf8(mean)),
    fullBox('name', 0, 0, encodeUtf8(name)),
    dataBox(DataType.Utf8, encodeUtf8(value)),
  );
}

/**
 * The `iTunSMPB` item: iTunes's statement of the encoder's priming, its padding
 * and the length between them, in hexadecimal among fields of zeros.
 */
export function gaplessItem(priming: number, padding: number, length: number): Uint8Array {
  const word = (value: number) => value.toString(16).toUpperCase().padStart(8, '0');
  const total = length.toString(16).toUpperCase().padStart(16, '0');
  const value = ` ${word(0)} ${word(priming)} ${word(padding)} ${total}${' 00000000'.repeat(8)}`;
  return freeFormItem(ITUNES_MEAN, GAPLESS_NAME, value);
}

/** The `ilst` box written, and the parts of the map it could not hold. */
export interface WrittenIlst {
  readonly items: readonly Uint8Array[];
  readonly dropped: readonly MetadataPart[];
}

/** The items of `map`, before any the writer adds of the stream's own. */
export function encodeIlstItems(map: MetadataMap): WrittenIlst {
  const dropped = partsNotHeld(map, {
    text: ALL_TEXT_KEYS,
    broadcast: false,
    cues: false,
    tuning: false,
    coverArt: true,
  });
  const items: Uint8Array[] = [];
  const text = map.text ?? {};

  for (const [key, value] of textEntries(map)) {
    const item = TEXT_ITEMS[key];
    if (item !== undefined) items.push(textItem(item, value));
  }
  const numbers = numberItems(text);
  items.push(...numbers.items);
  dropped.push(...numbers.dropped);
  if (text.isrc !== undefined && text.isrc !== '')
    items.push(freeFormItem(ITUNES_MEAN, 'ISRC', text.isrc));

  const { loop, partial } = taggedLoop(map.loops);
  if (loop !== undefined) {
    items.push(freeFormItem(ITUNES_MEAN, LOOP_START_TAG, String(loop.start)));
    items.push(freeFormItem(ITUNES_MEAN, LOOP_LENGTH_TAG, String(loop.length)));
  }
  if (partial) dropped.push({ kind: 'loops' });

  for (const field of map.foreign ?? []) {
    const written = foreignItem(field.scheme, field.key, field.value);
    if (written === undefined)
      dropped.push({ kind: 'foreign', scheme: field.scheme, key: field.key });
    else items.push(written);
  }

  if (map.coverArt !== undefined) {
    const type = PICTURE_TYPES.get(map.coverArt.mediaType);
    if (type !== undefined) items.push(box('covr', dataBox(type, map.coverArt.bytes)));
    // A picture of another kind has no data type, and the item has no place for a description.
    if (type === undefined || map.coverArt.description !== '') dropped.push({ kind: 'coverArt' });
  }
  return { items, dropped };
}

/** The `trkn` and `disk` items, which hold whole numbers to 65,535 alone, and the keys they cannot hold. */
function numberItems(text: Readonly<Partial<Record<MetadataTextKey, string>>>): WrittenIlst {
  const items: Uint8Array[] = [];
  const dropped: MetadataPart[] = [];
  const pairs = [
    ['trkn', 'trackNumber', 'trackTotal', 8],
    ['disk', 'discNumber', 'discTotal', 6],
  ] as const;
  for (const [item, numberKey, totalKey, length] of pairs) {
    const number = text[numberKey] ?? '';
    const total = text[totalKey] ?? '';
    if (number === '' && total === '') continue;
    const numbered = number === '' ? 0 : itemNumber(number);
    const totalled = total === '' ? 0 : itemNumber(total);
    if (numbered === undefined) dropped.push({ kind: 'text', key: numberKey });
    if (totalled === undefined) dropped.push({ kind: 'text', key: totalKey });
    if (numbered === undefined || totalled === undefined) continue;
    const body = new ByteWriter().u16(0).u16(numbered).u16(totalled);
    if (length === 8) body.u16(0);
    items.push(box(item, dataBox(DataType.Binary, body.toBytes())));
  }
  return { items, dropped };
}

/** The item a foreign field is written as, or `undefined` where it has none. */
function foreignItem(scheme: string, key: string, value: string): Uint8Array | undefined {
  const explicit = scheme === ILST_SCHEME ? FREE_FORM_KEY.exec(key) : null;
  if (explicit !== null) {
    const [, mean = '', name = ''] = explicit;
    return RESERVED_NAMES.has(name.toUpperCase()) && mean === ITUNES_MEAN
      ? undefined
      : freeFormItem(mean, name, value);
  }
  if (scheme === ILST_SCHEME && key.length === 4 && encodeLatin1(key) !== undefined) {
    const reserved = KEY_OF_ITEM.has(key) || ['trkn', 'disk', 'covr', 'gnre', '----'].includes(key);
    return reserved ? undefined : textItem(key, value);
  }
  if (key === '' || RESERVED_NAMES.has(key.toUpperCase())) return undefined;
  return freeFormItem(ITUNES_MEAN, key, value);
}

/** The children of a box's body: type and body, refusing a child that runs past it. */
function children(body: Uint8Array): DomainResult<readonly { type: string; body: Uint8Array }[]> {
  const view = viewOf(body);
  const found: { type: string; body: Uint8Array }[] = [];
  for (let offset = 0; offset < body.length;) {
    if (offset + 8 > body.length) return fail(malformed('An MP4 metadata item is cut short.'));
    const size = view.getUint32(offset);
    if (size < 8 || size > body.length - offset) {
      return fail(malformed('An MP4 metadata item states a size past the box holding it.'));
    }
    found.push({
      type: fourCharacterCode(body, offset + 4),
      body: body.subarray(offset + 8, offset + size),
    });
    offset += size;
  }
  return succeed(found);
}

/** A `data` box's type and value. */
interface ItemData {
  readonly type: number;
  readonly value: Uint8Array;
}

/** Reads the body of an `ilst` box into `gathering`. */
export function decodeIlst(
  body: Uint8Array,
  gathering: MetadataGathering,
): DomainResult<undefined> {
  const items = children(body);
  if (!items.ok) return items;
  for (const item of items.value) {
    const counted = gathering.countField();
    if (!counted.ok) return counted;
    const parts = children(item.body);
    if (!parts.ok) return parts;
    let mean: string | undefined;
    let name: string | undefined;
    let data: ItemData | undefined;
    for (const part of parts.value) {
      if (part.body.length < 4) continue;
      if (part.type === 'mean') mean = decodeUtf8(part.body.subarray(4));
      else if (part.type === 'name') name = decodeUtf8(part.body.subarray(4));
      else if (part.type === 'data' && data === undefined && part.body.length >= 8) {
        data = { type: viewOf(part.body).getUint32(0) & 0xffffff, value: part.body.subarray(8) };
      }
    }
    if (data === undefined) continue;
    const kept = readItem(item.type, mean, name, data, gathering);
    if (!kept.ok) return kept;
  }
  return succeed(undefined);
}

/** Reads one item's value into `gathering`. */
function readItem(
  type: string,
  mean: string | undefined,
  name: string | undefined,
  data: ItemData,
  gathering: MetadataGathering,
): DomainResult<undefined> {
  if (type === 'covr') {
    if (data.value.length > MAXIMUM_PICTURE_BYTES)
      return fail(metadataOverBound('picture', MAXIMUM_PICTURE_BYTES));
    const mediaType = PICTURE_MEDIA.get(data.type) ?? 'application/octet-stream';
    gathering.addCoverArt({ mediaType, description: '', bytes: data.value.slice() }, true);
    return succeed(undefined);
  }
  if (type === 'trkn' || type === 'disk') {
    if (data.value.length >= 6) {
      const view = viewOf(data.value);
      const [numberKey, totalKey] =
        type === 'trkn'
          ? (['trackNumber', 'trackTotal'] as const)
          : (['discNumber', 'discTotal'] as const);
      const number = view.getUint16(2);
      const total = view.getUint16(4);
      if (number > 0) gathering.addText(numberKey, String(number));
      if (total > 0) gathering.addText(totalKey, String(total));
    }
    return succeed(undefined);
  }
  if (type === 'gnre') {
    const genre =
      data.value.length >= 2 ? id3Genre(viewOf(data.value).getUint16(0) - 1) : undefined;
    if (genre !== undefined) gathering.addText('genre', genre);
    return succeed(undefined);
  }
  if (data.type !== DataType.Utf8) return succeed(undefined);
  if (data.value.length > MAXIMUM_TEXT_BYTES)
    return fail(metadataOverBound('MP4 metadata item', MAXIMUM_TEXT_BYTES));
  const value = decodeUtf8(data.value);

  if (type !== '----') {
    const key = KEY_OF_ITEM.get(type);
    if (key === undefined) gathering.addForeign(ILST_SCHEME, type, value);
    else gathering.addText(key, value);
    return succeed(undefined);
  }
  if (mean !== undefined && name !== undefined) readFreeForm(mean, name, value, gathering);
  return succeed(undefined);
}

/** Reads a free-form item's text: the ISRC, a loop tag, or a foreign field keyed as it is written back. */
function readFreeForm(
  mean: string,
  name: string,
  value: string,
  gathering: MetadataGathering,
): void {
  if (mean === ITUNES_MEAN) {
    const upper = name.toUpperCase();
    // The stream's gapless information is the writer's, never the person's metadata.
    if (upper === GAPLESS_NAME.toUpperCase()) return;
    if (upper === 'ISRC') {
      gathering.addText('isrc', value);
      return;
    }
    const part = loopTagPart(name);
    if (part !== undefined) {
      gathering.addLoopTag(part, ILST_SCHEME, name, value);
      return;
    }
    if (name.length !== 4) {
      gathering.addForeign(ILST_SCHEME, name, value);
      return;
    }
  }
  gathering.addForeign(ILST_SCHEME, `----:${mean}:${name}`, value);
}
