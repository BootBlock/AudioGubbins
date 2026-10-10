/**
 * The metadata blocks a FLAC file carries after its stream information
 * (RFC 9639, section 8), from a map, and the parts of the map they cannot hold.
 *
 * The map's Vorbis comments come first, then the cover as a `PICTURE` block,
 * then, where the person keeps them, the WAV `smpl`, `cue ` and label chunks
 * in `APPLICATION` `riff` blocks, and last 8 KiB of `PADDING`, as the
 * reference encoder leaves, so a tag editor can change the metadata without
 * rewriting the audio. The comments carry the first loop as `LOOPSTART` and
 * `LOOPLENGTH` as well, which game engines read where they read no RIFF chunk.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { ByteWriter } from './byte-writer.js';
import { encodeFlacPicture, writableMediaType } from './flac-picture.js';
import { riffApplicationBodies, type FlacPcmFormat } from './flac-riff-blocks.js';
import { unwritableStream } from './framing-failures.js';
import type { MetadataMap, MetadataPart } from './metadata-map.js';
import { encodeRiffLoopChunks } from './riff-loop-chunks.js';
import { encodeVorbisComment } from './vorbis-comment.js';

/** The metadata block types the writer writes and the reader reads. */
export const FlacBlockType = {
  StreamInfo: 0,
  Padding: 1,
  Application: 2,
  VorbisComment: 4,
  Picture: 6,
} as const;

/** The largest block body: its length is a 24-bit field. */
const MAXIMUM_BLOCK_BYTES = 0xffffff;

/** The padding left for a tag editor, as the reference encoder leaves it. */
const PADDING_BYTES = 8_192;

/** A block's type and body. */
export type FlacBlock = readonly [type: number, body: Uint8Array];

/** A block's bytes: its header, saying whether it is the last, then its body. */
export function encodeFlacBlock([type, body]: FlacBlock, last: boolean): Uint8Array {
  return new ByteWriter()
    .u8((last ? 0x80 : 0) | type)
    .u24(body.length)
    .bytes(body)
    .toBytes();
}

/** What the blocks of a map are written for. */
export interface FlacMetadataSettings {
  readonly metadata: MetadataMap;

  /** The encoder's name and version, written as the comments' vendor string. */
  readonly vendor: string;

  /** Whether the WAV loop, tuning and cue chunks are carried in `riff` blocks. */
  readonly keepRiffChunks: boolean;
}

/** The blocks of a map and the parts they could not hold. */
export interface FlacMetadata {
  readonly blocks: readonly FlacBlock[];
  readonly dropped: readonly MetadataPart[];
}

/**
 * The blocks after the stream information of a stream of `format`, refused
 * where the comments are past what a block holds.
 */
export function flacMetadataBlocks(
  settings: FlacMetadataSettings,
  format: FlacPcmFormat,
): DomainResult<FlacMetadata> {
  const map = settings.metadata;
  const dropped: MetadataPart[] = [];
  const blocks: FlacBlock[] = [];
  const riff = settings.keepRiffChunks ? encodeRiffLoopChunks(map, format.sampleRate) : undefined;
  const riffBodies =
    riff === undefined || riff.chunks.length === 0
      ? undefined
      : riffApplicationBodies(riff.chunks, format);

  const comments = encodeVorbisComment(map, { vendor: settings.vendor, pictureField: false });
  if (comments.bytes.length > MAXIMUM_BLOCK_BYTES) {
    return fail(unwritableStream('The metadata is too large for a FLAC comment block.'));
  }
  blocks.push([FlacBlockType.VorbisComment, comments.bytes]);
  // The comments answer for text and foreign fields; the blocks below hold the other parts, and
  // the loops are the sampler chunk's where it is carried, the comments holding the first alone.
  dropped.push(
    ...comments.dropped.filter(
      (part) =>
        part.kind === 'text' ||
        part.kind === 'foreign' ||
        (part.kind === 'loops' && riffBodies === undefined),
    ),
  );

  if (map.coverArt !== undefined) {
    const picture = writableMediaType(map.coverArt.mediaType)
      ? encodeFlacPicture(map.coverArt)
      : undefined;
    if (picture === undefined || picture.length > MAXIMUM_BLOCK_BYTES) {
      dropped.push({ kind: 'coverArt' });
    } else {
      blocks.push([FlacBlockType.Picture, picture]);
    }
  }

  if (riffBodies === undefined) {
    if ((map.cues?.length ?? 0) > 0) dropped.push({ kind: 'cues' });
    if (map.tuning !== undefined) dropped.push({ kind: 'tuning' });
  } else {
    for (const body of riffBodies) blocks.push([FlacBlockType.Application, body]);
    if (riff?.loopsPartial === true) dropped.push({ kind: 'loops' });
    if (riff?.cuesDropped === true) dropped.push({ kind: 'cues' });
    if (riff?.tuningDropped === true) dropped.push({ kind: 'tuning' });
  }
  if (map.broadcast !== undefined) dropped.push({ kind: 'broadcast' });
  blocks.push([FlacBlockType.Padding, new Uint8Array(PADDING_BYTES)]);
  return succeed({ blocks, dropped });
}
