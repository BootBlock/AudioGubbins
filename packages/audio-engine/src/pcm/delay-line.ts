/**
 * A delay of whole frames, on every channel of a block.
 *
 * What the executor aligns an early input with (REQ-ARCH-144) and what the
 * delay node is made of. Its history is sized once, for the delay, and a
 * block of any length passes through it, so the audio it produces does not
 * depend on how the stream was cut into blocks.
 */

import type { AudioFrameBlock } from './frame-block.js';

/** A running delay of a fixed number of frames. */
export class DelayLine {
  readonly #history: readonly Float32Array[];
  readonly #frames: number;
  #position = 0;

  /** A delay of `frames` whole frames on `channels` channels, starting silent. */
  constructor(channels: number, frames: number) {
    this.#frames = frames;
    this.#history = Array.from({ length: channels }, () => new Float32Array(frames));
  }

  /**
   * Writes the first `frames` frames of `input`, delayed, to `output`. The
   * two may be the same block: each sample is read before it is written.
   */
  process(input: AudioFrameBlock, output: AudioFrameBlock, frames: number): void {
    if (this.#frames === 0) {
      input.channels.forEach((channel, index) => {
        if (channel !== output.channels[index]) {
          output.channels[index]?.set(channel.subarray(0, frames));
        }
      });
      return;
    }
    let position = this.#position;
    this.#history.forEach((history, index) => {
      const from = input.channels[index];
      const to = output.channels[index];
      if (from === undefined || to === undefined) return;
      position = this.#position;
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = from[frame] ?? 0;
        to[frame] = history[position] ?? 0;
        history[position] = sample;
        position = position + 1 === this.#frames ? 0 : position + 1;
      }
    });
    this.#position = position;
  }
}
