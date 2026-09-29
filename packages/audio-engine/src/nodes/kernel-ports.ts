/**
 * The blocks and channels a kernel's step guarantees it, by index.
 *
 * The executor gives a kernel one block for each port of its step, each of
 * the port's layout, so a missing one is a fault in the executor rather than
 * in the audio. Reading one through here says so, where silently skipping it
 * would leave a reused buffer's stale audio in the output.
 */

import type { AudioFrameBlock } from '../pcm/frame-block.js';

/** The block of port `index`. */
export function portAt(blocks: readonly AudioFrameBlock[], index: number): AudioFrameBlock {
  const block = blocks[index];
  if (block === undefined) {
    throw new Error('A kernel was given fewer blocks than its step has ports.');
  }
  return block;
}

/** Channel `index` of a block. */
export function channelAt(block: AudioFrameBlock, index: number): Float32Array {
  const channel = block.channels[index];
  if (channel === undefined) {
    throw new Error('A kernel was given a block with fewer channels than its port layout.');
  }
  return channel;
}
