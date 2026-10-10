/**
 * How each sample encoding lays its frames out in blocks, and decodes them.
 *
 * Every encoding the read contract reads in place is a run of blocks of the
 * same size, each decodable alone: a frame of uncompressed PCM or G.711 is a
 * block of one, and an ADPCM block holds as many frames as its format chunk
 * says. A reader therefore reads only the blocks that cover the frames asked
 * for and decodes from the first of them, whatever the encoding (ADR-0090).
 *
 * The rule for a compressed code (ADR-0052's rule extended): each sample is
 * decoded to a 16-bit linear integer by its codec, then divided by 2^15, which
 * is exact in float32.
 */

import type { DomainResult } from '@audiogubbins/domain';

/** The scale of a 16-bit linear sample, by which every compressed code's sample is divided. */
export const LINEAR_16_SCALE = 2 ** 15;

/** How one encoding's frames lie in blocks, and how a run of them decodes. */
export interface BlockCoding {
  /** The bytes of one block, every channel's. */
  readonly blockBytes: number;
  readonly framesPerBlock: number;

  /** The whole frames the first `bytes` bytes of a run of blocks hold. */
  framesIn(bytes: number): number;

  /** The fewest bytes from the start of a run of blocks that hold its first `frames` frames. */
  bytesFor(frames: number): number;

  /**
   * Decodes `frames` frames from `bytes`, which begin at a block, after
   * skipping the first `skip` frames of that block, into planar `into` from
   * index `at`. Fails where a block's own header breaks its format's rules.
   */
  decode(
    bytes: Uint8Array,
    skip: number,
    frames: number,
    into: readonly Float32Array[],
    at: number,
  ): DomainResult<undefined>;
}

/** A coding whose blocks are single frames of `frameBytes` bytes each. */
export function frameCoding(frameBytes: number, decode: BlockCoding['decode']): BlockCoding {
  return {
    blockBytes: frameBytes,
    framesPerBlock: 1,
    framesIn: (bytes) => Math.floor(bytes / frameBytes),
    bytesFor: (frames) => frames * frameBytes,
    decode,
  };
}
