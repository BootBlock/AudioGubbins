/**
 * A sink's audio for the chunk being rendered, kept until it is written.
 *
 * The executor delivers a sink's block while it runs, and the block is a
 * buffer the next step may reuse. The render writes to its sink only after
 * the chunk has run, awaiting the write, so the block is copied here first.
 */

import type { SinkTarget } from '../nodes/node-implementation.js';
import { allocateBlock, blockView, type AudioFrameBlock } from '../pcm/frame-block.js';

/** The last block a sink received, copied. */
export class SinkCapture implements SinkTarget {
  readonly #chunkFrames: number;
  #captured: AudioFrameBlock | undefined;

  /** A capture of blocks of up to `chunkFrames` frames. */
  constructor(chunkFrames: number) {
    this.#chunkFrames = chunkFrames;
  }

  receive(block: AudioFrameBlock): void {
    // Sized at the first block, the first time the sink's layout is known.
    this.#captured ??= allocateBlock(block.layout, block.sampleRate, this.#chunkFrames);
    const captured = this.#captured;
    block.channels.forEach((channel, index) => {
      captured.channels[index]?.set(channel.subarray(0, block.frames));
    });
  }

  /** The frames `[start, start + frames)` of the last block received. */
  view(start: number, frames: number): AudioFrameBlock {
    if (this.#captured === undefined) throw new Error('A sink was read before it received audio.');
    return blockView(this.#captured, start, frames);
  }
}
