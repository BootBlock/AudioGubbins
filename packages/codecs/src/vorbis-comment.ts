/**
 * Vorbis comments, the metadata Ogg Vorbis, Opus and FLAC share (ADR-0093).
 *
 * A block is a vendor string and a list of `KEY=value` comments in UTF-8, each
 * length a 32-bit little-endian count. The map's text keys are written under
 * the field names the Xiph recommendations and common taggers use, the loop as
 * `LOOPSTART` and `LOOPLENGTH`, and the cover, where the format has no picture
 * block of its own, as `METADATA_BLOCK_PICTURE`. A foreign field is written
 * under its own key where that is a legal comment key, whatever format it came
 * from, and is read back as a `vorbis-comment` field.
 *
 * On reading, keys are matched without regard to case, as the specification
 * says, and these other names are accepted: `DESCRIPTION` for the comment,
 * `ALBUM ARTIST` for the album artist, `TOTALTRACKS` and `TOTALDISCS` for the
 * totals, and a `TRACKNUMBER` or `DISCNUMBER` written `n/m`, whose total is
 * taken where no total field is given.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { decodeBase64, encodeBase64 } from './base64.js';
import { viewOf } from './byte-reading.js';
import { ByteWriter } from './byte-writer.js';
import { malformed } from './codec-failures.js';
import {
  decodeFlacPicture,
  encodeFlacPicture,
  gatherPicture,
  writableMediaType,
  type FlacPicture,
} from './flac-picture.js';
import { metadataOverBound } from './framing-failures.js';
import { LOOP_LENGTH_TAG, LOOP_START_TAG, loopTagPart, taggedLoop } from './loop-tags.js';
import type { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_PICTURE_BYTES, MAXIMUM_TEXT_BYTES } from './metadata-limits.js';
import type { MetadataMap, MetadataPart, MetadataTextKey } from './metadata-map.js';
import { ALL_TEXT_KEYS, partsNotHeld, textEntries } from './metadata-parts.js';
import { decodeUtf8, encodeLatin1, encodeUtf8 } from './metadata-text.js';

/** The scheme a foreign comment is kept under. */
const VORBIS_COMMENT_SCHEME = 'vorbis-comment';

/** The field each text key is written under. */
const FIELD_NAMES: Readonly<Record<MetadataTextKey, string>> = {
  title: 'TITLE',
  artist: 'ARTIST',
  album: 'ALBUM',
  albumArtist: 'ALBUMARTIST',
  trackNumber: 'TRACKNUMBER',
  trackTotal: 'TRACKTOTAL',
  discNumber: 'DISCNUMBER',
  discTotal: 'DISCTOTAL',
  date: 'DATE',
  genre: 'GENRE',
  comment: 'COMMENT',
  copyright: 'COPYRIGHT',
  encoder: 'ENCODER',
  isrc: 'ISRC',
};

/** The text key each field name reads as, the written names and the other names accepted. */
const TEXT_KEY_OF: ReadonlyMap<string, MetadataTextKey> = new Map<string, MetadataTextKey>([
  ...[...ALL_TEXT_KEYS].map((key) => [FIELD_NAMES[key], key] as const),
  ['DESCRIPTION', 'comment'],
  ['ALBUM ARTIST', 'albumArtist'],
  ['TOTALTRACKS', 'trackTotal'],
  ['TOTALDISCS', 'discTotal'],
]);

/** The field a picture is carried in. */
const PICTURE_FIELD = 'METADATA_BLOCK_PICTURE';

/** A legal comment key: ASCII 0x20 to 0x7D except `=`, and not empty. */
const COMMENT_KEY = /^[\x20-\x3c\x3e-\x7d]+$/;

/** A number and a total written in one field, as `3/12`. */
const NUMBER_OF_TOTAL = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

/** How a block is laid out by the format carrying it. */
export interface VorbisCommentOptions {
  /** The vendor string, naming the software that wrote the stream. */
  readonly vendor: string;

  /** Whether the cover is carried as `METADATA_BLOCK_PICTURE`, where the format has no picture block. */
  readonly pictureField: boolean;
}

/** A comment block written, and the parts of the map it could not hold. */
export interface WrittenVorbisComment {
  readonly bytes: Uint8Array;
  readonly dropped: readonly MetadataPart[];
}

/** Whether a foreign key is one this writer writes itself, so writing it would contradict the map. */
function reservedKey(key: string): boolean {
  const upper = key.toUpperCase();
  return TEXT_KEY_OF.has(upper) || loopTagPart(upper) !== undefined || upper === PICTURE_FIELD;
}

/** The comment block of `map`. */
export function encodeVorbisComment(
  map: MetadataMap,
  options: VorbisCommentOptions,
): WrittenVorbisComment {
  const dropped: MetadataPart[] = partsNotHeld(map, {
    text: ALL_TEXT_KEYS,
    broadcast: false,
    cues: false,
    tuning: false,
    coverArt: true,
  });
  const comments: Uint8Array[] = [];
  const add = (key: string, value: Uint8Array): void => {
    const name = encodeLatin1(key) ?? new Uint8Array();
    const comment = new Uint8Array(name.length + 1 + value.length);
    comment.set(name, 0);
    comment[name.length] = 0x3d;
    comment.set(value, name.length + 1);
    comments.push(comment);
  };

  for (const [key, value] of textEntries(map)) add(FIELD_NAMES[key], encodeUtf8(value));

  const { loop, partial } = taggedLoop(map.loops);
  if (loop !== undefined) {
    add(LOOP_START_TAG, encodeUtf8(String(loop.start)));
    add(LOOP_LENGTH_TAG, encodeUtf8(String(loop.length)));
  }
  if (partial) dropped.push({ kind: 'loops' });

  for (const field of map.foreign ?? []) {
    if (COMMENT_KEY.test(field.key) && !reservedKey(field.key)) {
      add(field.key, encodeUtf8(field.value));
    } else {
      dropped.push({ kind: 'foreign', scheme: field.scheme, key: field.key });
    }
  }

  if (options.pictureField && map.coverArt !== undefined) {
    if (writableMediaType(map.coverArt.mediaType)) {
      add(PICTURE_FIELD, encodeBase64(encodeFlacPicture(map.coverArt)));
    } else {
      dropped.push({ kind: 'coverArt' });
    }
  }

  const vendor = encodeUtf8(options.vendor);
  const writer = new ByteWriter().u32(vendor.length, true).bytes(vendor).u32(comments.length, true);
  for (const comment of comments) writer.u32(comment.length, true).bytes(comment);
  return { bytes: writer.toBytes(), dropped };
}

/** The longest comment kept: a text value, or a picture in base64 with its key. */
const MAXIMUM_PICTURE_COMMENT_BYTES =
  PICTURE_FIELD.length +
  1 +
  Math.ceil((MAXIMUM_PICTURE_BYTES + MAXIMUM_TEXT_BYTES * 2 + 32) / 3) * 4;

/**
 * Reads a comment block into `gathering`, answering how many bytes it took. A
 * comment with no `=` names nothing and is passed over.
 */
export function decodeVorbisComment(
  block: Uint8Array,
  gathering: MetadataGathering,
): DomainResult<number> {
  const view = viewOf(block);
  const short = fail(malformed('A Vorbis comment block is shorter than the lengths it states.'));
  if (block.length < 4) return short;
  const vendorLength = view.getUint32(0, true);
  if (vendorLength > block.length - 8) return short;
  let offset = 4 + vendorLength;
  const count = view.getUint32(offset, true);
  offset += 4;
  const numbered: NumberComment[] = [];
  const totals = new Set<MetadataTextKey>();

  for (let index = 0; index < count; index += 1) {
    const counted = gathering.countField();
    if (!counted.ok) return counted;
    if (offset + 4 > block.length) return short;
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length > block.length - offset) return short;
    if (length > MAXIMUM_PICTURE_COMMENT_BYTES) {
      return fail(metadataOverBound('Vorbis comment', MAXIMUM_PICTURE_COMMENT_BYTES));
    }
    const comment = block.subarray(offset, offset + length);
    offset += length;
    const read = readComment(comment, gathering, numbered, totals);
    if (!read.ok) return read;
  }

  for (const { key, total, value } of numbered) {
    const split = NUMBER_OF_TOTAL.exec(value);
    if (split !== null && !totals.has(total)) {
      gathering.addText(key, split[1] ?? '');
      gathering.addText(total, split[2] ?? '');
      totals.add(total);
    } else {
      gathering.addText(key, value);
    }
  }
  return succeed(offset);
}

/** A track or disc number read, kept until every comment is read to learn whether a total was given. */
interface NumberComment {
  readonly key: 'trackNumber' | 'discNumber';
  readonly total: 'trackTotal' | 'discTotal';
  readonly value: string;
}

/**
 * Reads one comment into `gathering`, or a number into `numbered` and a total's
 * key into `totals`; a comment with no `=` names nothing and is passed over.
 */
function readComment(
  comment: Uint8Array,
  gathering: MetadataGathering,
  numbered: NumberComment[],
  totals: Set<MetadataTextKey>,
): DomainResult<undefined> {
  const separator = comment.indexOf(0x3d);
  if (separator <= 0) return succeed(undefined);
  const key = decodeUtf8(comment.subarray(0, separator));
  const upper = key.toUpperCase();
  const valueBytes = comment.subarray(separator + 1);
  if (upper === PICTURE_FIELD) {
    const picture = readPictureField(valueBytes);
    if (!picture.ok) return picture;
    if (picture.value !== undefined) gatherPicture(gathering, picture.value);
    return succeed(undefined);
  }
  if (valueBytes.length > MAXIMUM_TEXT_BYTES) {
    return fail(metadataOverBound('Vorbis comment', MAXIMUM_TEXT_BYTES));
  }
  const value = decodeUtf8(valueBytes);
  const textKey = TEXT_KEY_OF.get(upper);
  const loopPart = loopTagPart(upper);
  if (textKey === 'trackNumber' || textKey === 'discNumber') {
    numbered.push({
      key: textKey,
      total: textKey === 'trackNumber' ? 'trackTotal' : 'discTotal',
      value,
    });
  } else if (textKey !== undefined) {
    if (textKey === 'trackTotal' || textKey === 'discTotal') totals.add(textKey);
    gathering.addText(textKey, value);
  } else if (loopPart !== undefined) {
    gathering.addLoopTag(loopPart, VORBIS_COMMENT_SCHEME, key, value);
  } else {
    gathering.addForeign(VORBIS_COMMENT_SCHEME, key, value);
  }
  return succeed(undefined);
}

/** The picture a `METADATA_BLOCK_PICTURE` value holds, or `undefined` where it is not base64. */
function readPictureField(value: Uint8Array): DomainResult<FlacPicture | undefined> {
  const body = decodeBase64(value);
  if (body === undefined) return succeed(undefined);
  return decodeFlacPicture(body);
}
