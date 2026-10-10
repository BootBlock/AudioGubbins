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
export const FRONT_COVER = 3;

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

/** The picture a block's body states, refusing one whose lengths run past it or past the bounds. */
export function decodeFlacPicture(body: Uint8Array): DomainResult<FlacPicture> {
  const view = viewOf(body);
  let offset = 0;
  const field = (): number | undefined => {
    if (offset + 4 > body.length) return undefined;
    const value = view.getUint32(offset);
    offset += 4;
    return value;
  };
  const span = (length: number | undefined): Uint8Array | undefined => {
    if (length === undefined || length > body.length - offset) return undefined;
    const bytes = body.subarray(offset, offset + length);
    offset += length;
    return bytes;
  };
  const short = fail(malformed('A picture block is shorter than the lengths it states.'));

  const pictureType = field();
  const mediaTypeLength = field();
  if (mediaTypeLength !== undefined && mediaTypeLength > MAXIMUM_TEXT_BYTES) {
    return fail(metadataOverBound("picture's media type", MAXIMUM_TEXT_BYTES));
  }
  const mediaType = span(mediaTypeLength);
  const descriptionLength = field();
  if (descriptionLength !== undefined && descriptionLength > MAXIMUM_TEXT_BYTES) {
    return fail(metadataOverBound("picture's description", MAXIMUM_TEXT_BYTES));
  }
  const description = span(descriptionLength);
  // Width, height, colour depth and palette size: the picture's own header states them.
  const dimensions = span(16);
  const dataLength = field();
  if (dataLength !== undefined && dataLength > MAXIMUM_PICTURE_BYTES) {
    return fail(metadataOverBound('picture', MAXIMUM_PICTURE_BYTES));
  }
  const data = span(dataLength);
  if (
    pictureType === undefined ||
    mediaType === undefined ||
    description === undefined ||
    dimensions === undefined ||
    data === undefined
  ) {
    return short;
  }
  const mediaText = decodeLatin1(mediaType);
  if (!PRINTABLE_ASCII.test(mediaText)) {
    return fail(malformed("A picture's media type is not printable ASCII."));
  }
  return succeed({
    pictureType,
    cover: {
      mediaType: mediaText,
      description: decodeUtf8(description),
      bytes: data.slice(),
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
