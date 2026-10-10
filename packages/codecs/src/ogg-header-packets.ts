/**
 * The first packets of an Ogg file's first logical stream, read page by page
 * from its bytes, where a codec keeps its headers and its comments.
 *
 * Each page is read as its 27-byte header, its lacing and the body the lacing
 * states, at most 65,307 bytes, and its checksum is checked before any of it
 * is used. Pages of other logical streams multiplexed beside the first are
 * passed over. The walk stops at the bound on metadata bytes and on pages, so
 * a hostile file cannot make it read without end.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { readExactly } from './byte-reading.js';
import { concatenate } from './byte-writer.js';
import { malformed } from './codec-failures.js';
import { metadataOverBound } from './framing-failures.js';
import { MAXIMUM_METADATA_BYTES } from './metadata-limits.js';
import { OggPacketAssembler } from './ogg-packet-assembly.js';
import {
  BEGINNING_OF_STREAM,
  OGG_HEADER_BYTES,
  lacedLength,
  readOggPage,
  readOggPageHeader,
  type OggPage,
  type OggPageHeader,
} from './ogg-page.js';

/** The most pages read to find the headers: far more than any stream's headers span. */
const MAXIMUM_HEADER_PAGES = 4_096;

/**
 * The first `count` packets of the file's first logical stream, refusing a
 * file that does not begin with that stream's first page or ends before them.
 */
export async function readOggHeaderPackets(
  bytes: AudioBytes,
  count: number,
  signal?: CancellationSignal,
): Promise<DomainResult<readonly Uint8Array[]>> {
  const assembler = new OggPacketAssembler(MAXIMUM_METADATA_BYTES);
  const packets: Uint8Array[] = [];
  let serial: number | undefined;
  let offset = 0;
  let sequence = 0;
  for (let pages = 0; packets.length < count; pages += 1) {
    if (pages === MAXIMUM_HEADER_PAGES) {
      return fail(metadataOverBound('count of Ogg header pages', MAXIMUM_HEADER_PAGES));
    }
    const located = await pageAt(bytes, offset, signal);
    if (!located.ok) return located;
    if (located.value.end > MAXIMUM_METADATA_BYTES) {
      return fail(metadataOverBound('Ogg headers', MAXIMUM_METADATA_BYTES));
    }
    const { header } = located.value;
    if (serial === undefined) {
      if ((header.headerType & BEGINNING_OF_STREAM) === 0) {
        return fail(malformed('The Ogg file does not begin with the first page of a stream.'));
      }
      serial = header.serial;
      sequence = header.sequence;
    }
    if (header.serial === serial) {
      if (header.sequence !== sequence) {
        return fail(malformed('A page of the Ogg stream is missing or out of order.'));
      }
      sequence += 1;
      const page = await readPage(bytes, located.value, signal);
      if (!page.ok) return page;
      const assembled = assembler.add(page.value);
      if (!assembled.ok) return assembled;
      packets.push(...assembled.value.packets);
    }
    offset = located.value.end;
  }
  return succeed(packets.slice(0, count));
}

/** A page found by its header and lacing, its body not yet read. */
interface LocatedPage {
  readonly header: OggPageHeader;
  readonly prefix: Uint8Array;
  readonly bodyOffset: number;
  readonly end: number;
}

/** The page at `offset`, found by its header and lacing, refused where it runs past the file. */
async function pageAt(
  bytes: AudioBytes,
  offset: number,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<LocatedPage>> {
  if (offset + OGG_HEADER_BYTES > bytes.size) {
    return fail(malformed("The Ogg file ends before its stream's headers do."));
  }
  const fixed = await readExactly(bytes, offset, OGG_HEADER_BYTES, signal);
  if (!fixed.ok) return fixed;
  const header = readOggPageHeader(fixed.value);
  if (!header.ok) return header;
  const bodyOffset = offset + OGG_HEADER_BYTES + header.value.segments;
  if (bodyOffset > bytes.size) return fail(malformed('The Ogg file ends inside a page.'));
  const lacing = await readExactly(bytes, offset + OGG_HEADER_BYTES, header.value.segments, signal);
  if (!lacing.ok) return lacing;
  const end = bodyOffset + lacedLength(lacing.value);
  if (end > bytes.size) return fail(malformed('The Ogg file ends inside a page.'));
  return succeed({
    header: header.value,
    prefix: concatenate([fixed.value, lacing.value]),
    bodyOffset,
    end,
  });
}

/** The whole page found, its body read and its checksum checked. */
async function readPage(
  bytes: AudioBytes,
  located: LocatedPage,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<OggPage>> {
  const body = await readExactly(
    bytes,
    located.bodyOffset,
    located.end - located.bodyOffset,
    signal,
  );
  if (!body.ok) return body;
  return readOggPage(concatenate([located.prefix, body.value]));
}
