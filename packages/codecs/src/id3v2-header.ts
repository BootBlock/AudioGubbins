/**
 * The ten-byte header of an ID3v2 tag at the start of a file, which MP3 files
 * carry and some taggers put before a FLAC file's marker too.
 *
 * The tag's size is a "synchsafe" integer, seven bits in each of four bytes,
 * counting what follows the header and not a footer, which version 2.4 may add
 * after the tag.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { readExactly } from './byte-reading.js';
import { malformed } from './codec-failures.js';

export const ID3V2_HEADER_BYTES = 10;

/** The flag of version 2.4 saying a ten-byte footer follows the tag. */
const FOOTER_PRESENT = 0x10;

/** An ID3v2 tag's header. */
export interface Id3v2Header {
  /** The major version: 2, 3 or 4. */
  readonly version: number;
  readonly flags: number;

  /** The bytes after the header that the tag spans: its frames, padding and extended header. */
  readonly size: number;

  /** The tag's whole length in the file, header and footer included. */
  readonly length: number;
}

/** A synchsafe integer of `count` bytes at `offset`, or `undefined` where a byte has its top bit set. */
export function synchsafe(bytes: Uint8Array, offset: number, count: number): number | undefined {
  let value = 0;
  for (let index = 0; index < count; index += 1) {
    const byte = bytes[offset + index] ?? 0x80;
    if (byte >= 0x80) return undefined;
    value = value * 128 + byte;
  }
  return value;
}

/** The header `bytes` begins with, `undefined` where it is not one, refused where it is a broken one. */
export function readId3v2Header(bytes: Uint8Array): DomainResult<Id3v2Header | undefined> {
  if (
    bytes.length < ID3V2_HEADER_BYTES ||
    bytes[0] !== 0x49 ||
    bytes[1] !== 0x44 ||
    bytes[2] !== 0x33
  ) {
    return succeed(undefined);
  }
  const version = bytes[3] ?? 0;
  const flags = bytes[5] ?? 0;
  const size = synchsafe(bytes, 6, 4);
  if (version < 2 || version > 4 || bytes[4] === 0xff || size === undefined) {
    return fail(
      malformed('An ID3v2 tag header states a version or size the format does not allow.'),
    );
  }
  const footer = version === 4 && (flags & FOOTER_PRESENT) !== 0 ? ID3V2_HEADER_BYTES : 0;
  return succeed({ version, flags, size, length: ID3V2_HEADER_BYTES + size + footer });
}

/** The length of the ID3v2 tag the file begins with, or 0 where it begins with none. */
export async function id3v2TagLength(
  bytes: AudioBytes,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<number>> {
  if (bytes.size < ID3V2_HEADER_BYTES) return succeed(0);
  const head = await readExactly(bytes, 0, ID3V2_HEADER_BYTES, signal);
  if (!head.ok) return head;
  const header = readId3v2Header(head.value);
  if (!header.ok) return header;
  if (header.value === undefined) return succeed(0);
  return header.value.length > bytes.size
    ? fail(malformed('An ID3v2 tag runs past the end of the file.'))
    : succeed(header.value.length);
}
