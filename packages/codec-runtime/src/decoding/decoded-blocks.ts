/**
 * A stream decoded block by block, whatever decodes it (ADR-0090): the codec
 * module, or the browser's decoder for HE-AAC (`browser-aac-blocks.ts`).
 *
 * Each block is planar 32-bit floats in the stream's channel order at its own
 * rate, in planes of their own memory, so a block is transferred to the
 * storage worker rather than copied, and every block but the last holds the
 * stated count of frames, so the memory a decode holds is that block and no
 * more. The planes are made for each block, since a transferred buffer is
 * gone from the sender.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import type { DecoderSession } from '../decoder-session.js';

/** One decoded block: a plane per channel, each `frames` long. */
export interface DecodedBlock {
  readonly channels: readonly Float32Array<ArrayBuffer>[];
  readonly frames: number;
}

/** A stream's blocks, in order. */
export interface DecodedBlocks {
  /** The next block, or `undefined` at the stream's end. A failure is final. */
  next(): Promise<DomainResult<DecodedBlock | undefined>>;
  /** Releases what decodes the stream. A second call does nothing. */
  release(): void;
}

/** The most bytes of samples one block holds, across its channels. */
const BLOCK_BYTES = 1_048_576;

/** The most frames one block holds, whatever its channels. */
const MOST_BLOCK_FRAMES = 65_536;

/**
 * The frames of each block of a stream of `channels` channels: as many as fit
 * the block's bytes, at most {@link MOST_BLOCK_FRAMES}, so a stream of many
 * channels sends shorter blocks rather than larger ones.
 */
export function blockFrames(channels: number): number {
  return Math.max(
    1,
    Math.min(
      MOST_BLOCK_FRAMES,
      Math.floor(BLOCK_BYTES / (channels * Float32Array.BYTES_PER_ELEMENT)),
    ),
  );
}

/** The first `frames` of each plane, as planes of exactly that length over the same memory. */
export function trimmedPlanes(
  planes: readonly Float32Array<ArrayBuffer>[],
  frames: number,
): Float32Array<ArrayBuffer>[] {
  return planes.map((plane) => new Float32Array(plane.buffer, 0, frames));
}

/** A stream the codec module decodes. */
class ModuleDecodedBlocks implements DecodedBlocks {
  readonly #session: DecoderSession;
  readonly #frames: number;
  #ended = false;

  constructor(session: DecoderSession) {
    this.#session = session;
    this.#frames = blockFrames(session.description.channelCount);
  }

  next(): Promise<DomainResult<DecodedBlock | undefined>> {
    if (this.#ended) return Promise.resolve(succeed(undefined));
    const planes = Array.from(
      { length: this.#session.description.channelCount },
      () => new Float32Array(this.#frames),
    );
    let filled = 0;
    // The module answers fewer frames than asked whenever a packet ends, so a
    // block is filled by as many calls as it takes, each from where the last
    // stopped.
    while (filled < this.#frames) {
      const decoded = this.#session.decode(planes.map((plane) => plane.subarray(filled)));
      if (!decoded.ok) return Promise.resolve(decoded);
      if (decoded.value === 0) {
        this.#ended = true;
        break;
      }
      filled += decoded.value;
    }
    if (filled === 0) return Promise.resolve(succeed(undefined));
    return Promise.resolve(succeed({ channels: trimmedPlanes(planes, filled), frames: filled }));
  }

  release(): void {
    this.#session.release();
  }
}

/** The blocks of a stream the codec module decodes through `session`, which they release. */
export function moduleDecodedBlocks(session: DecoderSession): DecodedBlocks {
  return new ModuleDecodedBlocks(session);
}
