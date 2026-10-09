/**
 * A model's output over a whole stream, gathered as it is made and handed
 * over as one planar `Float32Array`: every frame of the first channel, then
 * every frame of the second, and so on, the measurement a machine-learning
 * processor's kernel plays back.
 *
 * Its length is not known until the stream ends, so each channel is kept in
 * blocks of a fixed size, never in an array grown by copying, and the planar
 * array is made once, at the end, of exactly the frames asked for.
 */

/** The frames of one block of a channel. */
const BLOCK_FRAMES = 65_536;

export class PlanarOutput {
  readonly #channels: Float32Array[][];
  #frames = 0;

  constructor(channels: number) {
    this.#channels = Array.from({ length: channels }, () => []);
  }

  /** The frames written so far. */
  get frames(): number {
    return this.#frames;
  }

  /** Appends the first `frames` frames of `input`, one array per channel. */
  write(input: readonly Float32Array[], frames: number): void {
    for (let done = 0; done < frames;) {
      const at = this.#frames % BLOCK_FRAMES;
      const length = Math.min(frames - done, BLOCK_FRAMES - at);
      for (const [channel, blocks] of this.#channels.entries()) {
        if (at === 0) blocks.push(new Float32Array(BLOCK_FRAMES));
        const block = blocks[blocks.length - 1];
        const from = input[channel];
        if (block !== undefined && from !== undefined) {
          block.set(from.subarray(done, done + length), at);
        }
      }
      done += length;
      this.#frames += length;
    }
  }

  /**
   * The output as one planar array of `frames` frames a channel: the frames
   * written, cut, or followed by silence, to that length. The blocks are let
   * go as they are copied.
   */
  planar(frames: number): Float32Array {
    const out = new Float32Array(frames * this.#channels.length);
    for (const [channel, blocks] of this.#channels.entries()) {
      const base = channel * frames;
      for (const [index, block] of blocks.entries()) {
        const start = index * BLOCK_FRAMES;
        if (start >= frames) break;
        out.set(block.subarray(0, Math.min(BLOCK_FRAMES, frames - start)), base + start);
      }
      blocks.length = 0;
    }
    return out;
  }
}
