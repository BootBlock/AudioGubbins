/**
 * Frames of a planar stream, as `framing.rs` gives them: frame `k` is the
 * `size` samples from sample `k · hop`, ready once its last sample has been
 * pushed, whatever chunks the stream arrived in.
 *
 * Each channel's samples are kept in one array from the first sample a frame
 * still reads, grown by doubling when a push needs more room, and the samples
 * no frame will read dropped once a frame's worth has gathered, so a caller
 * reading frames as it pushes settles at a frame and a chunk of memory and then
 * allocates nothing.
 */

export class ReferenceFraming {
  readonly size: number;
  readonly #hop: number;
  #held: Float32Array[];
  /** The samples each channel's array holds, from absolute sample `#start`. */
  #used = 0;
  #start = 0;
  /** Where the next frame starts, at or after `#start`. */
  #next = 0;

  /** Frames of `size` samples `hop` apart over `channels`, already checked. */
  constructor(channels: number, size: number, hop: number) {
    this.size = size;
    this.#hop = hop;
    this.#held = Array.from({ length: channels }, () => new Float32Array(2 * size));
  }

  get channels(): number {
    return this.#held.length;
  }

  /** Appends `frames` samples of each channel, one array per channel, checked by the port. */
  push(input: readonly Float32Array[], frames: number): void {
    const needed = this.#used + frames;
    const capacity = this.#held[0]?.length ?? 0;
    if (needed > capacity) {
      const grown = Math.max(2 * capacity, needed);
      for (let channel = 0; channel < this.#held.length; channel += 1) {
        const larger = new Float32Array(grown);
        larger.set((this.#held[channel] ?? larger).subarray(0, this.#used));
        this.#held[channel] = larger;
      }
    }
    for (let channel = 0; channel < this.#held.length; channel += 1) {
      const arriving = input[channel];
      if (arriving !== undefined) this.#held[channel]?.set(arriving, this.#used);
    }
    this.#used = needed;
  }

  /** Whether the next frame's last sample has been pushed. */
  get ready(): boolean {
    return this.#next + this.size <= this.#start + this.#used;
  }

  /** The absolute position of the next frame's first sample. */
  get position(): number {
    return this.#next;
  }

  /** Where the next frame starts in each channel's {@link samples}. */
  get offset(): number {
    return this.#next - this.#start;
  }

  /** Channel `channel`'s held samples: the next frame is `size` of them from {@link offset}. */
  samples(channel: number): Float32Array {
    return this.#held[channel] ?? new Float32Array(0);
  }

  /** Moves to the frame after the next, dropping what no frame reads once a frame's worth gathered. */
  advance(): void {
    this.#next += this.#hop;
    const consumed = this.#next - this.#start;
    if (consumed >= this.size) {
      for (const samples of this.#held) samples.copyWithin(0, consumed, this.#used);
      this.#used -= consumed;
      this.#start = this.#next;
    }
  }
}
