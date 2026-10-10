/**
 * The frames of an ID3v2.2, 2.3 or 2.4 tag read into a map (ADR-0093).
 *
 * The tag is held whole, within the metadata bound, and read in memory:
 * unsynchronisation is undone for the whole tag (2.2 and 2.3, and 2.4 where
 * the header says every frame is) or per frame (2.4), an extended header is
 * passed over, and each frame's size is held within the tag. Text is read in
 * each of the four encodings, Latin-1, UTF-16 with a byte order mark, UTF-16
 * big-endian and UTF-8, and a frame of several values gives each. A frame that
 * is compressed or encrypted is passed over, since its bytes are not text.
 *
 * A genre given as ID3v1 numbers, `(17)` or `17`, is read as the genre's name;
 * version 2.3's `TYER` and `TDAT` are read as one date; a text frame with no
 * mapping is kept under its id, a `TXXX` under its description, and a `COMM`
 * with a description under `COMM:` and the description.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { metadataOverBound } from './framing-failures.js';
import { id3Genre } from './id3-genres.js';
import { ID3V2_SCHEME, KEY_OF_FRAME, NUMBER_FRAMES, VERSION_2_FRAMES } from './id3v2-frames.js';
import { synchsafe, type Id3v2Header } from './id3v2-header.js';
import { loopTagPart } from './loop-tags.js';
import type { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_PICTURE_BYTES, MAXIMUM_TEXT_BYTES } from './metadata-limits.js';
import { decodeLatin1, decodeUtf16, decodeUtf8 } from './metadata-text.js';

const UNSYNCHRONISED = 0x80;
const EXTENDED_HEADER = 0x40;

/** Version 2.4's frame flags. */
const V4_GROUPED = 0x0040;
const V4_COMPRESSED = 0x0008;
const V4_ENCRYPTED = 0x0004;
const V4_UNSYNCHRONISED = 0x0002;
const V4_LENGTH_INDICATED = 0x0001;

/** Version 2.3's frame flags. */
const V3_COMPRESSED = 0x0080;
const V3_ENCRYPTED = 0x0040;
const V3_GROUPED = 0x0020;

/** A genre given by number, alone or in brackets, before any text. */
const NUMBERED_GENRE = /^\((\d{1,3})\)|^(\d{1,3})$/;

/** Version 2.3's day and month, `DDMM`. */
const DAY_MONTH = /^(\d{2})(\d{2})$/;

/** A number and a total written in one frame, as `3/12`. */
const NUMBER_OF_TOTAL = /^\s*([^/]*?)\s*(?:\/\s*(.*?)\s*)?$/;

/** The bytes with every `0xFF 0x00` turned back into `0xFF`. */
function resynchronised(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let written = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    out[written] = byte;
    written += 1;
    if (byte === 0xff && bytes[index + 1] === 0) index += 1;
  }
  return out.subarray(0, written);
}

/** Text in an ID3v2 encoding. */
function decodeText(encoding: number, bytes: Uint8Array): string {
  switch (encoding) {
    case 1:
      return decodeUtf16(bytes, false);
    case 2:
      return decodeUtf16(bytes, true);
    case 3:
      return decodeUtf8(bytes);
    default:
      return decodeLatin1(bytes);
  }
}

/** Where the text that starts at `offset` ends: its terminator, one byte or two by encoding. */
function terminatorAt(encoding: number, bytes: Uint8Array, offset: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let at = offset; at + 1 < bytes.length; at += 2)
      if (bytes[at] === 0 && bytes[at + 1] === 0) return at;
    return bytes.length;
  }
  const at = bytes.indexOf(0, offset);
  return at < 0 ? bytes.length : at;
}

/** The terminator's length in an encoding. */
const terminatorBytes = (encoding: number): number => (encoding === 1 || encoding === 2 ? 2 : 1);

/** The values of a text frame's body: its encoding byte, then values separated by terminators. */
function textValues(body: Uint8Array): string[] {
  const encoding = body[0] ?? 0;
  const values: string[] = [];
  for (let offset = 1; offset < body.length;) {
    const end = terminatorAt(encoding, body, offset);
    const value = decodeText(encoding, body.subarray(offset, end));
    if (value !== '') values.push(value);
    offset = end + terminatorBytes(encoding);
  }
  return values;
}

/** One frame as read: its id, as version 2.3 names it, and its body. */
interface Id3Frame {
  readonly id: string;
  readonly body: Uint8Array;
}

/** The frames of a tag's body, the bytes after its header, refusing past the bounds. */
function framesOf(header: Id3v2Header, tag: Uint8Array): Id3Frame[] {
  const whole = header.version < 4 || (header.flags & UNSYNCHRONISED) !== 0;
  let body = whole && (header.flags & UNSYNCHRONISED) !== 0 ? resynchronised(tag) : tag;
  if (header.version > 2 && (header.flags & EXTENDED_HEADER) !== 0 && body.length >= 4) {
    const stated =
      header.version === 3 ? viewOf(body).getUint32(0) + 4 : (synchsafe(body, 0, 4) ?? body.length);
    body = body.subarray(Math.min(stated, body.length));
  }
  const view = viewOf(body);
  const idBytes = header.version === 2 ? 3 : 4;
  const frameHeader = header.version === 2 ? 6 : 10;
  const frames: Id3Frame[] = [];
  for (let offset = 0; offset + frameHeader <= body.length;) {
    if (body[offset] === 0) break;
    const rawId = String.fromCharCode(...body.subarray(offset, offset + idBytes));
    let size: number | undefined;
    let flags = 0;
    if (header.version === 2) {
      size =
        ((body[offset + 3] ?? 0) << 16) | ((body[offset + 4] ?? 0) << 8) | (body[offset + 5] ?? 0);
    } else {
      size = header.version === 3 ? view.getUint32(offset + 4) : synchsafe(body, offset + 4, 4);
      flags = view.getUint16(offset + 8);
    }
    const start = offset + frameHeader;
    if (size === undefined || size > body.length - start) break;
    let frameBody = body.subarray(start, start + size);
    offset = start + size;

    if (header.version === 4) {
      if ((flags & (V4_COMPRESSED | V4_ENCRYPTED)) !== 0) continue;
      if ((flags & V4_GROUPED) !== 0) frameBody = frameBody.subarray(1);
      if ((flags & V4_LENGTH_INDICATED) !== 0) frameBody = frameBody.subarray(4);
      if ((flags & V4_UNSYNCHRONISED) !== 0 && !whole) frameBody = resynchronised(frameBody);
    } else if (header.version === 3) {
      if ((flags & (V3_COMPRESSED | V3_ENCRYPTED)) !== 0) continue;
      if ((flags & V3_GROUPED) !== 0) frameBody = frameBody.subarray(1);
    }
    const id = header.version === 2 ? VERSION_2_FRAMES.get(rawId) : rawId;
    if (id !== undefined) frames.push({ id, body: frameBody });
  }
  return frames;
}

/** Reads the frames of a tag, the `header.size` bytes after its header, into `gathering`. */
export function readId3v2Frames(
  header: Id3v2Header,
  tag: Uint8Array,
  gathering: MetadataGathering,
): DomainResult<undefined> {
  // Version 2.2's compression flag names a scheme no one defined, so its frames cannot be read.
  if (header.version === 2 && (header.flags & 0x40) !== 0) return succeed(undefined);
  let year: string | undefined;
  let dayMonth: string | undefined;
  for (const frame of framesOf(header, tag)) {
    const counted = gathering.countField();
    if (!counted.ok) return counted;
    const { id, body } = frame;
    if (id === 'APIC') {
      const read = readPicture(header.version, body, gathering);
      if (!read.ok) return read;
      continue;
    }
    if (body.length > MAXIMUM_TEXT_BYTES)
      return fail(metadataOverBound('ID3v2 frame', MAXIMUM_TEXT_BYTES));
    if (id === 'COMM') {
      readComment(body, gathering);
      continue;
    }
    if (!id.startsWith('T')) continue;
    if (id === 'TXXX') {
      readUserText(body, gathering);
      continue;
    }
    const values = textValues(body);
    if (values.length === 0) continue;
    if (id === 'TYER') {
      year = values[0];
      continue;
    }
    if (id === 'TDAT') {
      dayMonth = values[0];
      continue;
    }
    if (id === 'TRCK' || id === 'TPOS') {
      readNumber(id, values[0] ?? '', gathering);
      continue;
    }
    const key = KEY_OF_FRAME.get(id);
    for (const value of values) {
      if (key === undefined) gathering.addForeign(ID3V2_SCHEME, id, value);
      else gathering.addText(key, key === 'genre' ? genreName(value) : value);
    }
  }
  if (year !== undefined) {
    const day = dayMonth === undefined ? null : DAY_MONTH.exec(dayMonth);
    gathering.addText('date', day === null ? year : `${year}-${day[2] ?? ''}-${day[1] ?? ''}`);
  } else if (dayMonth !== undefined) {
    gathering.addForeign(ID3V2_SCHEME, 'TDAT', dayMonth);
  }
  return succeed(undefined);
}

/** A genre's name, where it is given as an ID3v1 number alone or in brackets before no text. */
function genreName(value: string): string {
  const numbered = NUMBERED_GENRE.exec(value);
  if (numbered === null) return value;
  const rest = value.slice(numbered[0].length);
  if (rest !== '') return rest;
  return id3Genre(Number(numbered[1] ?? numbered[2])) ?? value;
}

function readNumber(id: 'TRCK' | 'TPOS', value: string, gathering: MetadataGathering): void {
  const [numberKey, totalKey] = NUMBER_FRAMES[id];
  const split = NUMBER_OF_TOTAL.exec(value);
  const number = split?.[1] ?? value;
  const total = split?.[2];
  if (number !== '') gathering.addText(numberKey, number);
  if (total !== undefined && total !== '') gathering.addText(totalKey, total);
}

function readUserText(body: Uint8Array, gathering: MetadataGathering): void {
  const encoding = body[0] ?? 0;
  const end = terminatorAt(encoding, body, 1);
  const description = decodeText(encoding, body.subarray(1, end));
  const value = decodeText(
    encoding,
    body.subarray(Math.min(body.length, end + terminatorBytes(encoding))),
  );
  const part = loopTagPart(description);
  if (part !== undefined) gathering.addLoopTag(part, ID3V2_SCHEME, description, value);
  else gathering.addForeign(ID3V2_SCHEME, description, value);
}

function readComment(body: Uint8Array, gathering: MetadataGathering): void {
  const encoding = body[0] ?? 0;
  const end = terminatorAt(encoding, body, 4);
  const description = decodeText(encoding, body.subarray(4, end));
  const text = decodeText(
    encoding,
    body.subarray(Math.min(body.length, end + terminatorBytes(encoding))),
  );
  if (text === '') return;
  if (description === '') gathering.addText('comment', text);
  else gathering.addForeign(ID3V2_SCHEME, `COMM:${description}`, text);
}

/** Version 2.2's three-letter image formats, as media types. */
const VERSION_2_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ['JPG', 'image/jpeg'],
  ['PNG', 'image/png'],
  ['GIF', 'image/gif'],
  ['BMP', 'image/bmp'],
]);

function readPicture(
  version: number,
  body: Uint8Array,
  gathering: MetadataGathering,
): DomainResult<undefined> {
  const encoding = body[0] ?? 0;
  let offset: number;
  let mediaType: string;
  if (version === 2) {
    const format = decodeLatin1(body.subarray(1, 4));
    mediaType = VERSION_2_IMAGE_TYPES.get(format.toUpperCase()) ?? `image/${format.toLowerCase()}`;
    offset = 4;
  } else {
    const end = terminatorAt(0, body, 1);
    mediaType = decodeLatin1(body.subarray(1, end));
    offset = end + 1;
  }
  const pictureType = body[offset];
  const descriptionEnd = terminatorAt(encoding, body, offset + 1);
  const description = decodeText(
    encoding,
    body.subarray(Math.min(body.length, offset + 1), descriptionEnd),
  );
  const data = body.subarray(Math.min(body.length, descriptionEnd + terminatorBytes(encoding)));
  if (pictureType === undefined || data.length === 0 || mediaType === '-->')
    return succeed(undefined);
  if (data.length > MAXIMUM_PICTURE_BYTES)
    return fail(metadataOverBound('picture', MAXIMUM_PICTURE_BYTES));
  const front = pictureType === 3;
  if (gathering.keepsCoverArt(front)) {
    gathering.addCoverArt({ mediaType, description, bytes: data.slice() }, front);
  }
  return succeed(undefined);
}
