/**
 * One Ogg page (RFC 3533): its header, its lacing and its body, written and
 * read with the checksum the format defines.
 *
 * A page is at most 27 header bytes, 255 lacing values and 255 segments of 255
 * bytes, so every read of one is bounded by its own fields. Its checksum is
 * CRC-32 over the whole page with the checksum field zeroed, by the polynomial
 * 0x04C11DB7, unreflected, from zero and with no final inversion, which is not
 * the CRC-32 of ZIP; a page whose checksum disagrees is refused.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';

/** `OggS`, which begins every page. */
export const OGG_CAPTURE = Uint8Array.from([0x4f, 0x67, 0x67, 0x53]);

/** The header's fixed bytes, before the lacing values. */
export const OGG_HEADER_BYTES = 27;

/** The most segments, and so lacing values, one page holds. */
export const MAXIMUM_SEGMENTS = 255;

/** The largest page: a full header, full lacing and full segments. */
export const MAXIMUM_PAGE_BYTES = OGG_HEADER_BYTES + MAXIMUM_SEGMENTS + MAXIMUM_SEGMENTS * 255;

/** The header type flags. */
export const CONTINUED_PACKET = 0x01;
export const BEGINNING_OF_STREAM = 0x02;
export const END_OF_STREAM = 0x04;

/** A page's granule position: a count, or `'none'` where no packet ends on the page (-1 in the file). */
export type GranulePosition = number | 'none';

/** One page's fields and body. */
export interface OggPage {
  readonly headerType: number;
  readonly granule: GranulePosition;
  readonly serial: number;
  readonly sequence: number;

  /** The lacing values: each segment's length, 255 meaning the packet continues. */
  readonly lacing: Uint8Array;
  readonly body: Uint8Array;
}

/** The checksum table, one entry per byte value. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let remainder = index << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      remainder = remainder & 0x80000000 ? (remainder << 1) ^ 0x04c11db7 : remainder << 1;
    }
    table[index] = remainder >>> 0;
  }
  return table;
})();

/** The Ogg checksum of `bytes`, continuing from `crc`. */
export function oggCrc(bytes: Uint8Array, crc = 0): number {
  let remainder = crc;
  for (const byte of bytes) {
    remainder = ((remainder << 8) ^ (CRC_TABLE[((remainder >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return remainder;
}

/** The page's bytes, its checksum computed. */
export function encodeOggPage(page: OggPage): Uint8Array {
  const segments = page.lacing.length;
  const bytes = new Uint8Array(OGG_HEADER_BYTES + segments + page.body.length);
  const view = viewOf(bytes);
  bytes.set(OGG_CAPTURE, 0);
  view.setUint8(4, 0);
  view.setUint8(5, page.headerType);
  if (page.granule === 'none') {
    view.setUint32(6, 0xffffffff, true);
    view.setUint32(10, 0xffffffff, true);
  } else {
    view.setUint32(6, page.granule % 2 ** 32, true);
    view.setUint32(10, Math.floor(page.granule / 2 ** 32), true);
  }
  view.setUint32(14, page.serial, true);
  view.setUint32(18, page.sequence, true);
  view.setUint8(26, segments);
  bytes.set(page.lacing, OGG_HEADER_BYTES);
  bytes.set(page.body, OGG_HEADER_BYTES + segments);
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
}

/** A page's header fields, read from its first 27 bytes, and the lengths that follow. */
export interface OggPageHeader {
  readonly headerType: number;
  readonly granule: GranulePosition;
  readonly serial: number;
  readonly sequence: number;
  readonly segments: number;
}

/**
 * The header of the page whose first 27 bytes are `bytes`, refusing a capture
 * pattern, version or flag the format does not define, and a granule position
 * past the exact whole numbers.
 */
export function readOggPageHeader(bytes: Uint8Array): DomainResult<OggPageHeader> {
  if (bytes.length < OGG_HEADER_BYTES || OGG_CAPTURE.some((byte, index) => bytes[index] !== byte)) {
    return fail(malformed("An Ogg page does not begin with its capture pattern, 'OggS'."));
  }
  const view = viewOf(bytes);
  const version = view.getUint8(4);
  if (version !== 0) {
    return fail(
      malformed(`An Ogg page states version ${String(version)}; only version 0 is defined.`),
    );
  }
  const headerType = view.getUint8(5);
  if ((headerType & ~(CONTINUED_PACKET | BEGINNING_OF_STREAM | END_OF_STREAM)) !== 0) {
    return fail(malformed('An Ogg page sets a header flag the format does not define.'));
  }
  const low = view.getUint32(6, true);
  const high = view.getUint32(10, true);
  let granule: GranulePosition;
  if (low === 0xffffffff && high === 0xffffffff) {
    granule = 'none';
  } else if (high >= 2 ** 21) {
    return fail(malformed("An Ogg page states a granule position past any stream's length."));
  } else {
    granule = high * 2 ** 32 + low;
  }
  return succeed({
    headerType,
    granule,
    serial: view.getUint32(14, true),
    sequence: view.getUint32(18, true),
    segments: view.getUint8(26),
  });
}

/** The body length the lacing values state. */
export function lacedLength(lacing: Uint8Array): number {
  let length = 0;
  for (const value of lacing) length += value;
  return length;
}

/**
 * The page whose bytes are `bytes`, all of them, refusing one whose checksum
 * disagrees with its contents.
 */
export function readOggPage(bytes: Uint8Array): DomainResult<OggPage> {
  const header = readOggPageHeader(bytes);
  if (!header.ok) return header;
  const lacingEnd = OGG_HEADER_BYTES + header.value.segments;
  const lacing = bytes.subarray(OGG_HEADER_BYTES, lacingEnd);
  if (lacing.length !== header.value.segments || bytes.length !== lacingEnd + lacedLength(lacing)) {
    return fail(malformed('An Ogg page is shorter or longer than its lacing values state.'));
  }
  const stated = viewOf(bytes).getUint32(22, true);
  const zeroed = bytes.slice();
  viewOf(zeroed).setUint32(22, 0, true);
  if (oggCrc(zeroed) !== stated) {
    return fail(malformed("An Ogg page's checksum disagrees with its contents."));
  }
  return succeed({
    headerType: header.value.headerType,
    granule: header.value.granule,
    serial: header.value.serial,
    sequence: header.value.sequence,
    lacing,
    body: bytes.subarray(lacingEnd),
  });
}
