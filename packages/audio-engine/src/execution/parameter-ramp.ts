/**
 * Parameter smoothing: a change of value spread over a short linear ramp.
 *
 * A gain that jumps between two samples is heard as a click, so a running
 * parameter moves to a new value over {@link PARAMETER_RAMP_DIVISOR}ths of a
 * second. The ramp is basic arithmetic in a stated order (ADR-0032): the value
 * `k` frames into a ramp of `n` is `start + (delta · k) / n`, which reaches
 * the target exactly at `n` and gives the same bits however the frames are
 * split into blocks.
 */

import type { SampleRate } from '@audiogubbins/domain';

/** A ramp lasts one part in this many of a second: 10 ms. */
const PARAMETER_RAMP_DIVISOR = 100;

/** Frames a ramp lasts at `sampleRate`, at least one. */
export function rampFrames(sampleRate: SampleRate): number {
  return Math.max(1, Math.ceil(sampleRate / PARAMETER_RAMP_DIVISOR));
}

/** A parameter's value, frame by frame, ramping to each new target. */
export class ParameterRamp {
  readonly #length: number;
  #start: number;
  #target: number;
  #delta = 0;
  #step: number;

  /** A ramp at `initial`, which spreads each change over `length` frames. */
  constructor(initial: number, length: number) {
    this.#length = length;
    this.#start = initial;
    this.#target = initial;
    this.#step = length;
  }

  /** Whether the value is at its target, so a caller may read it once for a block. */
  get steady(): boolean {
    return this.#step >= this.#length;
  }

  /** The value of the current frame, without advancing. */
  get value(): number {
    // The target itself once the ramp ends: `start + delta` can round away from it.
    return this.steady ? this.#target : this.#start + (this.#delta * this.#step) / this.#length;
  }

  /** Starts a ramp from the current value to `target`. */
  set(target: number): void {
    this.#start = this.value;
    this.#target = target;
    this.#delta = target - this.#start;
    this.#step = 0;
  }

  /**
   * Writes the value of each of the next `frames` frames into `into`, and
   * advances past them. A block at a time, into an array, because a double
   * returned from a call a frame at a time is a heap number on the audio
   * thread.
   */
  fill(into: Float64Array, frames: number): void {
    const length = this.#length;
    const start = this.#start;
    const delta = this.#delta;
    const target = this.#target;
    let step = this.#step;
    for (let frame = 0; frame < frames; frame += 1) {
      if (step >= length) {
        into[frame] = target;
      } else {
        into[frame] = start + (delta * step) / length;
        step += 1;
      }
    }
    this.#step = step;
  }
}
