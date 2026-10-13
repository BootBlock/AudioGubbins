/**
 * A block's planes as 32-bit floats, the samples a lossy encoder takes. A
 * rendered block is 32-bit already and is passed as it is; a 64-bit plane is
 * rounded into an array kept from block to block, grown only when a block is
 * longer than any before it.
 */

import type { SamplePlane } from '@audiogubbins/codecs';

/** The 32-bit planes of blocks, one block at a time. */
export class Float32Planes {
  #scratch: Float32Array[] = [];

  /** `planes`' first `frames` frames, each a `Float32Array`, valid until the next call. */
  of(planes: readonly SamplePlane[], frames: number): readonly Float32Array[] {
    return planes.map((plane, channel) => {
      if (plane instanceof Float32Array) return plane.subarray(0, frames);
      let scratch = this.#scratch[channel];
      if (scratch === undefined || scratch.length < frames) {
        scratch = new Float32Array(frames);
        this.#scratch[channel] = scratch;
      }
      const into = scratch.subarray(0, frames);
      into.set(plane.subarray(0, frames));
      return into;
    });
  }
}
