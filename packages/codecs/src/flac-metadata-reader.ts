/**
 * The metadata of a FLAC file: its Vorbis comments, its pictures, and the WAV
 * chunks its `APPLICATION` `riff` blocks carry (ADR-0093).
 *
 * The walk reads each block's four-byte header and only the bodies it keeps, so
 * a large block of another kind costs one small read. It refuses a file whose
 * first block is not the stream information, a block that runs past the file,
 * the reserved block type, and more blocks or bytes than the bounds, and it
 * skips an ID3v2 tag some taggers put before the `fLaC` marker.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { fourCharacterCode, readExactly } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { decodeFlacPicture, gatherPicture } from './flac-picture.js';
import { RIFF_APPLICATION, riffChunkOfApplication } from './flac-riff-blocks.js';
import { FlacBlockType } from './flac-metadata-blocks.js';
import { metadataOverBound } from './framing-failures.js';
import { id3v2TagLength } from './id3v2-header.js';
import { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_METADATA_BYTES, MAXIMUM_METADATA_FIELDS } from './metadata-limits.js';
import type { MetadataMap } from './metadata-map.js';
import { RiffLoopChunkReading } from './riff-loop-chunks.js';
import { decodeVorbisComment } from './vorbis-comment.js';

const BLOCK_HEADER_BYTES = 4;
const STREAM_INFO_BYTES = 34;
const RESERVED_BLOCK_TYPE = 127;

/** The metadata of a FLAC file. */
export async function readFlacMetadata(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> {
  const first = await firstBlockOffset(bytes, signal);
  if (!first.ok) return first;
  let offset = first.value;

  const gathering = new MetadataGathering();
  const riff = new RiffLoopChunkReading();
  let read = 0;
  for (let index = 0; ; index += 1) {
    if (index === MAXIMUM_METADATA_FIELDS) {
      return fail(metadataOverBound('count of FLAC metadata blocks', MAXIMUM_METADATA_FIELDS));
    }
    if (offset + BLOCK_HEADER_BYTES > bytes.size) {
      return fail(malformed('The FLAC file ends inside its metadata.'));
    }
    const header = await blockHeader(bytes, offset, index === 0, signal);
    if (!header.ok) return header;
    const { last, type, length } = header.value;
    const body = offset + BLOCK_HEADER_BYTES;

    const kept = await keptBody(bytes, type, body, length, gathering, signal);
    if (!kept.ok) return kept;
    if (kept.value !== undefined) {
      read += kept.value.length;
      if (read > MAXIMUM_METADATA_BYTES)
        return fail(metadataOverBound('metadata', MAXIMUM_METADATA_BYTES));
      const taken = readBlock(type, kept.value, gathering, riff);
      if (!taken.ok) return taken;
    }
    offset = body + length;
    if (last) break;
  }
  riff.finish(gathering);
  return succeed(gathering.toMap());
}

/** Where the first metadata block begins: after the `fLaC` marker and any ID3v2 tag before it. */
async function firstBlockOffset(
  bytes: AudioBytes,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<number>> {
  const start = await id3v2TagLength(bytes, signal);
  if (!start.ok) return start;
  if (start.value + 4 > bytes.size) return fail(malformed('The file ends before its FLAC marker.'));
  const marker = await readExactly(bytes, start.value, 4, signal);
  if (!marker.ok) return marker;
  if (fourCharacterCode(marker.value, 0) !== 'fLaC') {
    return fail(malformed("The file does not begin with FLAC's marker, 'fLaC'."));
  }
  return succeed(start.value + 4);
}

/** A block's header: whether it is the last, its type and its body's length. */
interface BlockHeader {
  readonly last: boolean;
  readonly type: number;
  readonly length: number;
}

/**
 * The header of the block at `offset`, refusing one past the file, of the
 * reserved type, or out of place: the stream information first, and only first.
 */
async function blockHeader(
  bytes: AudioBytes,
  offset: number,
  first: boolean,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<BlockHeader>> {
  if (offset + BLOCK_HEADER_BYTES > bytes.size) {
    return fail(malformed('The FLAC file ends inside its metadata.'));
  }
  const header = await readExactly(bytes, offset, BLOCK_HEADER_BYTES, signal);
  if (!header.ok) return header;
  const [flags = 0, high = 0, middle = 0, low = 0] = header.value;
  const type = flags & 0x7f;
  const length = (high << 16) | (middle << 8) | low;
  if (offset + BLOCK_HEADER_BYTES + length > bytes.size) {
    return fail(malformed('A FLAC metadata block runs past the end of the file.'));
  }
  if (type === RESERVED_BLOCK_TYPE) {
    return fail(malformed('A FLAC metadata block has the reserved type 127.'));
  }
  if (first !== (type === FlacBlockType.StreamInfo) || (first && length !== STREAM_INFO_BYTES)) {
    return fail(malformed('A FLAC file must begin with one stream information block of 34 bytes.'));
  }
  return succeed({ last: (flags & 0x80) !== 0, type, length });
}

/** The body of a block the reader keeps, or `undefined` for a block it passes over. */
async function keptBody(
  bytes: AudioBytes,
  type: number,
  offset: number,
  length: number,
  gathering: MetadataGathering,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<Uint8Array | undefined>> {
  if (type === FlacBlockType.VorbisComment) return await readExactly(bytes, offset, length, signal);
  if (type === FlacBlockType.Picture) {
    // A front cover replaces any other picture; once one is kept, later pictures are not read.
    return gathering.keepsCoverArt(true)
      ? await readExactly(bytes, offset, length, signal)
      : succeed(undefined);
  }
  if (type === FlacBlockType.Application && length >= 4) {
    const id = await readExactly(bytes, offset, 4, signal);
    if (!id.ok) return id;
    return fourCharacterCode(id.value, 0) === RIFF_APPLICATION
      ? await readExactly(bytes, offset, length, signal)
      : succeed(undefined);
  }
  return succeed(undefined);
}

/** Reads a kept block's body into the map. */
function readBlock(
  type: number,
  body: Uint8Array,
  gathering: MetadataGathering,
  riff: RiffLoopChunkReading,
): DomainResult<undefined> {
  if (type === FlacBlockType.VorbisComment) {
    const taken = decodeVorbisComment(body, gathering);
    return taken.ok ? succeed(undefined) : taken;
  }
  if (type === FlacBlockType.Picture) {
    const picture = decodeFlacPicture(body);
    if (!picture.ok) return picture;
    gatherPicture(gathering, picture.value);
    return succeed(undefined);
  }
  const counted = gathering.countField();
  if (!counted.ok) return counted;
  const chunk = riffChunkOfApplication(body.subarray(4));
  if (chunk !== undefined) riff.read(chunk, gathering);
  return succeed(undefined);
}
