/**
 * A delay of whole frames on each channel of a block, each channel its own.
 *
 * What the executor aligns an early input with (REQ-ARCH-144), with the same
 * length on every channel, and what the delay node is made of, which may give
 * each channel its own (REQ-ARCH-157). Each channel's history is sized once,
 * for its delay, with its own place in it, and a block of any length passes
 * through, so the audio it produces does not depend on how the stream was cut
 * into blocks.
 */

import type { AudioFrameBlock } from './frame-block.js';

/** A running delay of a fixed number of frames on each channel. */
export class DelayLine {
  readonly #history: readonly Float32Array[];

  /** Where each channel's history is next read and written. */
  readonly #positions: Float64Array;

  /** A delay of `frames[channel]` whole frames on each channel, starting silent. */
  constructor(frames: readonly number[]) {
    this.#history = frames.map((length) => new Float32Array(length));
    this.#positions = new Float64Array(frames.length);
  }

  /**
   * Writes the first `frames` frames of `input`, delayed, to `output`. The
   * two may be the same block: each sample is read before it is written.
   */
  process(input: AudioFrameBlock, output: AudioFrameBlock, frames: number): void {
    // Indexed loops and element copies throughout: this runs every quantum on
    // the audio thread, where a callback or a subarray view is an allocation.
    const histories = this.#history;
    const positions = this.#positions;
    for (let channel = 0; channel < histories.length; channel += 1) {
      const from = input.channels[channel];
      const to = output.channels[channel];
      const history = histories[channel];
      if (from === undefined || to === undefined || history === undefined) continue;
      const length = history.length;
      if (length === 0) {
        if (from !== to) {
          for (let frame = 0; frame < frames; frame += 1) to[frame] = from[frame] ?? 0;
        }
        continue;
      }
      let position = positions[channel] ?? 0;
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = from[frame] ?? 0;
        to[frame] = history[position] ?? 0;
        history[position] = sample;
        position = position + 1 === length ? 0 : position + 1;
      }
      positions[channel] = position;
    }
  }
}
