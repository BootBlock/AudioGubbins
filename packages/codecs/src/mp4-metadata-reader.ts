/**
 * The metadata of an MP4 or M4A file: the items of its `ilst` box (ADR-0093).
 *
 * The walk reads box headers alone, from the top level down the path iTunes
 * writes, `moov`/`udta`/`meta`/`ilst`, or `moov`/`meta`/`ilst` as some writers
 * place it, and reads only the `ilst` box's body. A `meta` box is a full box
 * in ISO files and a plain one in QuickTime's, and both are read. Each level
 * stops after a bound of boxes, a box whose size runs past its parent is
 * refused, and the `ilst` body is read only within the metadata bound.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { fourCharacterCode, readExactly, viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { metadataOverBound } from './framing-failures.js';
import { decodeIlst } from './ilst-metadata.js';
import { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_METADATA_BYTES, MAXIMUM_METADATA_FIELDS } from './metadata-limits.js';
import type { MetadataMap } from './metadata-map.js';

/** Where a box's body lies. */
interface BoxSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * The body of the first box of `type` among the boxes from `range.start` to
 * `range.end`, or `undefined` where there is none.
 */
async function childOf(
  bytes: AudioBytes,
  range: BoxSpan,
  type: string,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<BoxSpan | undefined>> {
  let offset = range.start;
  for (let count = 0; offset + 8 <= range.end; count += 1) {
    if (count === MAXIMUM_METADATA_FIELDS) {
      return fail(metadataOverBound('count of MP4 boxes', MAXIMUM_METADATA_FIELDS));
    }
    const header = await readExactly(bytes, offset, 8, signal);
    if (!header.ok) return header;
    const stated = viewOf(header.value).getUint32(0);
    let headerBytes = 8;
    let size = stated;
    if (stated === 1) {
      if (offset + 16 > range.end) return fail(malformed('An MP4 box is cut short.'));
      const large = await readExactly(bytes, offset + 8, 8, signal);
      if (!large.ok) return large;
      const view = viewOf(large.value);
      size = view.getUint32(0) * 2 ** 32 + view.getUint32(4);
      headerBytes = 16;
    } else if (stated === 0) {
      size = range.end - offset;
    }
    if (size < headerBytes || size > range.end - offset) {
      return fail(malformed('An MP4 box states a size past the box or file holding it.'));
    }
    if (fourCharacterCode(header.value, 4) === type) {
      return succeed({ start: offset + headerBytes, end: offset + size });
    }
    offset += size;
  }
  return succeed(undefined);
}

/** The children's span of a `meta` box: after its version and flags, unless it is QuickTime's plain box. */
async function metaChildren(
  bytes: AudioBytes,
  meta: BoxSpan,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<BoxSpan>> {
  if (meta.end - meta.start < 8) return succeed({ start: meta.end, end: meta.end });
  const first = await readExactly(bytes, meta.start, 8, signal);
  if (!first.ok) return first;
  const plain = fourCharacterCode(first.value, 4) === 'hdlr';
  return succeed({ start: meta.start + (plain ? 0 : 4), end: meta.end });
}

/** The metadata of an MP4 file's `ilst` box. */
export async function readMp4Metadata(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> {
  const moov = await childOf(bytes, { start: 0, end: bytes.size }, 'moov', signal);
  if (!moov.ok) return moov;
  if (moov.value === undefined) return fail(malformed('The MP4 file has no movie box.'));

  let meta: BoxSpan | undefined;
  const udta = await childOf(bytes, moov.value, 'udta', signal);
  if (!udta.ok) return udta;
  if (udta.value !== undefined) {
    const inUdta = await childOf(bytes, udta.value, 'meta', signal);
    if (!inUdta.ok) return inUdta;
    meta = inUdta.value;
  }
  if (meta === undefined) {
    const inMoov = await childOf(bytes, moov.value, 'meta', signal);
    if (!inMoov.ok) return inMoov;
    meta = inMoov.value;
  }
  const gathering = new MetadataGathering();
  if (meta === undefined) return succeed(gathering.toMap());

  const children = await metaChildren(bytes, meta, signal);
  if (!children.ok) return children;
  const ilst = await childOf(bytes, children.value, 'ilst', signal);
  if (!ilst.ok) return ilst;
  if (ilst.value === undefined) return succeed(gathering.toMap());
  const length = ilst.value.end - ilst.value.start;
  if (length > MAXIMUM_METADATA_BYTES)
    return fail(metadataOverBound('metadata', MAXIMUM_METADATA_BYTES));
  const body = await readExactly(bytes, ilst.value.start, length, signal);
  if (!body.ok) return body;
  const read = decodeIlst(body.value, gathering);
  if (!read.ok) return read;
  return succeed(gathering.toMap());
}
