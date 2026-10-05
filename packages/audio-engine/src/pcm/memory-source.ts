/**
 * A source over audio already in memory, such as a decoded clip or a test's
 * generated signal.
 *
 * It keeps the arrays it is given and reads by copying the part asked for
 * into the reader's block, so a reader never holds a view it could write
 * through into the source.
 */

import { mapResult, sampleCount, throwIfCancelled, type DomainResult } from '@audiogubbins/domain';

import type { AudioFrameBlock } from './frame-block.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';

/** A source that reads the frames of `block`. */
export function memorySource(block: AudioFrameBlock): DomainResult<PcmSource> {
  return mapResult(sampleCount(block.frames), (length) => ({
    layout: block.layout,
    sampleRate: block.sampleRate,
    length,
    // An executor, so a refused read rejects the promise rather than throwing
    // before the caller holds one.
    read: (start, into, signal) =>
      new Promise<number>((resolve) => {
        throwIfCancelled(signal);
        assertReadableInto(block, into);
        const count = framesAvailable(length, start, into.frames);
        block.channels.forEach((channel, index) => {
          into.channels[index]?.set(channel.subarray(start, start + count));
        });
        resolve(count);
      }),
    // The arrays are the caller's, and nothing else was made.
    release: () => undefined,
  }));
}
