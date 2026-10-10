/**
 * FLAC's picture block body (RFC 9639, section 8.8), which FLAC carries as a
 * `PICTURE` block and Vorbis comments carry base64-encoded as
 * `METADATA_BLOCK_PICTURE`.
 *
 * The map's cover is written as picture type 3, the front cover. Its width,
 * height, colour depth and palette size are written as 0, since the map holds
 * the picture's bytes and media type alone and a reader takes the dimensions
 * from the picture's own header; a written 0 claims nothing false. Reading is
 * bounded by the block and by the picture bound, and the media type must be
 * printable ASCII, as the format requires.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { ByteWriter } from './byte-writer.js';
import { malformed } from './codec-failures.js';
import { metadataOverBound } from './framing-failures.js';
import type { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_PICTURE_BYTES, MAXIMUM_TEXT_BYTES } from './metadata-limits.js';
import type { CoverArt } from './metadata-map.js';
import { decodeLatin1, decodeUtf8, encodeLatin1, encodeUtf8 } from './metadata-text.js';

/** The picture type of a front cover, in ID3v2's `APIC` numbering, which FLAC shares. */
const FRONT_COVER = 3;

/** A media type as the block holds one: printable ASCII. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** Whether a picture's media type can be written in a picture block. */
export function writableMediaType(mediaType: string): boolean {
  return PRINTABLE_ASCII.test(mediaType);
}

/** The picture block's body for a cover whose media type {@link writableMediaType} accepts. */
export function encodeFlacPicture(cover: CoverArt): Uint8Array {
  const mediaType = encodeLatin1(cover.mediaType) ?? new Uint8Array();
  const description = encodeUtf8(cover.description);
  return new ByteWriter()
    .u32(FRONT_COVER)
    .u32(mediaType.length)
    .bytes(mediaType)
    .u32(description.length)
    .bytes(description)
    .zeros(16)
    .u32(cover.bytes.length)
    .bytes(cover.bytes)
    .toBytes();
}

/** A picture block read: its type and the cover it holds. */
export interface FlacPicture {
  readonly pictureType: number;
  readonly cover: CoverArt;
}

/** A position in a block's body, read forward. */
class FieldCursor {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** The next `length` bytes, or `undefined` where the body ends first. */
  take(length: number): Uint8Array | undefined {
    if (length > this.bytes.length - this.offset) return undefined;
    const taken = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return taken;
  }

  /** The bytes a 32-bit big-endian length before them states, refused past `bound` or the body. */
  prefixed(bound: number, what: string): DomainResult<Uint8Array> {
    const length = this.take(4);
    if (length === undefined) return SHORT_PICTURE;
    const stated = viewOf(length).getUint32(0);
    if (stated > bound) return fail(metadataOverBound(what, bound));
    const bytes = this.take(stated);
    return bytes === undefined ? SHORT_PICTURE : succeed(bytes);
  }
}

const SHORT_PICTURE = fail(malformed('A picture block is shorter than the lengths it states.'));

/** The picture a block's body states, refusing one whose lengths run past it or past the bounds. */
export function decodeFlacPicture(body: Uint8Array): DomainResult<FlacPicture> {
  const cursor = new FieldCursor(body);
  const pictureType = cursor.take(4);
  if (pictureType === undefined) return SHORT_PICTURE;
  const mediaType = cursor.prefixed(MAXIMUM_TEXT_BYTES, "picture's media type");
  if (!mediaType.ok) return mediaType;
  const description = cursor.prefixed(MAXIMUM_TEXT_BYTES, "picture's description");
  if (!description.ok) return description;
  // Width, height, colour depth and palette size: the picture's own header states them.
  if (cursor.take(16) === undefined) return SHORT_PICTURE;
  const data = cursor.prefixed(MAXIMUM_PICTURE_BYTES, 'picture');
  if (!data.ok) return data;
  const mediaText = decodeLatin1(mediaType.value);
  if (!PRINTABLE_ASCII.test(mediaText)) {
    return fail(malformed("A picture's media type is not printable ASCII."));
  }
  return succeed({
    pictureType: viewOf(pictureType).getUint32(0),
    cover: {
      mediaType: mediaText,
      description: decodeUtf8(description.value),
      bytes: data.value.slice(),
    },
  });
}

/** The media type that marks a picture's data as a link to it, which a map never follows or keeps. */
const LINKED_PICTURE = '-->';

/** Keeps a picture read as the map's cover where it is one the map keeps. */
export function gatherPicture(gathering: MetadataGathering, picture: FlacPicture): void {
  if (picture.cover.mediaType === LINKED_PICTURE) return;
  gathering.addCoverArt(picture.cover, picture.pictureType === FRONT_COVER);
}
