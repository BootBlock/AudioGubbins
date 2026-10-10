/**
 * The dither and quantisation before an integer encoder (ADR-0092): each
 * block quantised by the export's one `Quantiser` before the writer takes it,
 * so the integers a file holds are the ones its dither chose.
 *
 * The quantiser is given the channels in the rendered layout's order, which
 * is the order its noise streams are keyed by, whatever order the file writes
 * them in. Its output is 64-bit, since a 32-bit float cannot hold every
 * 32-bit integer step; the planes are kept from block to block and grown only
 * when a block is longer than any before it.
 */

import { throwIfCancelled } from '@audiogubbins/domain';
import type { AudioFileWriter, SamplePlane } from '@audiogubbins/codecs';
import type { Quantiser } from '@audiogubbins/import-export';

import { blockProblem } from './framed-file-writer.js';

/** `writer`, its blocks first quantised by `quantiser` for `channels` channels. */
export function quantisingWriter(
  writer: AudioFileWriter,
  quantiser: Quantiser,
  channels: number,
): AudioFileWriter {
  let planes: readonly Float64Array[] = [];
  const planesOf = (frames: number): readonly Float64Array[] => {
    if ((planes[0]?.length ?? -1) < frames) {
      planes = Array.from({ length: channels }, () => new Float64Array(frames));
    }
    return planes.map((plane) => plane.subarray(0, frames));
  };
  return {
    write: async (block: readonly SamplePlane[], frames, signal) => {
      throwIfCancelled(signal);
      const problem = blockProblem(block, frames, channels);
      // The writer refuses the block itself, and ends, as it would unquantised.
      if (problem !== undefined) return await writer.write(block, frames, signal);
      const quantised = planesOf(frames);
      quantiser.quantise(block, frames, quantised);
      return await writer.write(quantised, frames, signal);
    },
    finish: async (signal) => await writer.finish(signal),
  };
}
