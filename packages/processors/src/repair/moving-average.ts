/**
 * A linear-phase low-pass: four moving averages of `K` frames in cascade, on
 * every channel alike, each channel with its own state.
 *
 * Its response is `(sin(πfK/fs) / (K · sin(πf/fs)))⁴`, a smooth bell with
 * side lobes 52 dB down, and its delay is exactly `2(K − 1)` frames at every
 * frequency, so the input delayed by that much less the low band is its
 * exact complement: what is taken from the low band is taken from the signal
 * with no phase left over, as no recursive low-pass allows. `K` is the odd
 * length at which the response is one half at the split frequency, where the
 * low band and its complement are equal, `πfK/fs` being 1.0019, so
 * `K = 2⌊0.1595 · fs / f⌋ + 1`.
 *
 * Each average is a running sum of its ring, made exact again from the ring
 * every `K` frames, counted from the kernel's first, so no rounding gathers
 * and the sums are the same however the stream is cut. A ring is in time
 * order from its first index when the sum is remade, so the sum adds the
 * frames oldest first.
 */

import { finiteSample } from '../framework/sample-safety.js';

/** The averages in cascade. */
const STAGES = 4;

/** `y / 2π` where `(sin y / y)⁴ = 1/2`: half `K` in periods of the split frequency. */
const HALF_LENGTH_PER_PERIOD = 0.1595;

/** The odd length `K` of each average for a split at `frequency` Hz at `rate`. */
export function averageLength(rate: number, frequency: number): number {
  return 2 * Math.max(1, Math.floor((HALF_LENGTH_PER_PERIOD * rate) / frequency)) + 1;
}

/** The low-pass's delay in frames for averages of `length` frames. */
export function averageDelay(length: number): number {
  return (STAGES * (length - 1)) / 2;
}

export class MovingAverageLowPass {
  readonly #length: number;
  /** Each channel's rings, stage after stage, `K` frames apiece. */
  readonly #rings: Float64Array;
  /** Each channel's running sums, stage after stage. */
  readonly #sums: Float64Array;
  /** The low band of the last frame {@link run} took, read in place. */
  readonly output = new Float64Array(1);

  constructor(channels: number, length: number) {
    this.#length = length;
    this.#rings = new Float64Array(channels * STAGES * length);
    this.#sums = new Float64Array(channels * STAGES);
  }

  /**
   * Takes frame `frame` of `input`, read through `finiteSample`, as absolute
   * frame `position` of `channel`, and writes the low band `2(K − 1)` frames
   * before it to {@link output}.
   */
  run(channel: number, input: Float32Array, frame: number, position: number): void {
    const length = this.#length;
    const rings = this.#rings;
    const sums = this.#sums;
    const at = position % length;
    const remade = at === length - 1;
    let value = finiteSample(input[frame] ?? 0);
    for (let stage = 0; stage < STAGES; stage += 1) {
      const which = channel * STAGES + stage;
      const base = which * length;
      const old = rings[base + at] ?? 0;
      rings[base + at] = value;
      let sum = (sums[which] ?? 0) + value - old;
      if (remade) {
        sum = 0;
        for (let index = 0; index < length; index += 1) sum += rings[base + index] ?? 0;
      }
      sums[which] = sum;
      value = sum / length;
    }
    this.output[0] = value;
  }
}
