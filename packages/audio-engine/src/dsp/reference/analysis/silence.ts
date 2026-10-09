/**
 * Silence features, as `silence.rs` extracts them: per block, an event
 * `[first sample, length, peak, energy]` for each run of frames whose every
 * channel's magnitude is at most `threshold`, the energy the sum of the
 * squares of the run's samples frame by frame and within a frame channel by
 * channel (ADR-0032).
 */

import { EventQueue } from './event-queue.js';
import type { FeatureExtractor } from './feature-extractor.js';
import { ReferenceFraming } from './framing.js';

/** Runs of frames quiet on every channel, the settings already checked. */
export class ReferenceSilence implements FeatureExtractor {
  readonly recordWidth = 4;
  readonly #framing: ReferenceFraming;
  readonly #threshold: number;
  readonly #events = new EventQueue();

  constructor(channels: number, block: number, threshold: number) {
    this.#framing = new ReferenceFraming(channels, block, block);
    this.#threshold = threshold;
  }

  push(input: readonly Float32Array[], frames: number): void {
    this.#framing.push(input, frames);
  }

  pull(into: Float64Array): number {
    const capacity = Math.floor(into.length / 4);
    let written = 0;
    for (;;) {
      written = this.#events.drain(into, written, capacity);
      if (written === capacity || !this.#framing.ready) return written;
      this.#events.clear();
      this.#runs();
      this.#framing.advance();
    }
  }

  /** Whether frame `n` of the next block is quiet on every channel; `quiet`. */
  #quiet(n: number): boolean {
    const framing = this.#framing;
    for (let channel = 0; channel < framing.channels; channel += 1) {
      // A NaN fails the comparison, so it is never quiet.
      if (!(Math.abs(framing.samples(channel)[framing.offset + n] ?? 0) <= this.#threshold)) {
        return false;
      }
    }
    return true;
  }

  /** Queues the events of the next block; `runs_of`. */
  #runs(): void {
    const framing = this.#framing;
    const block = framing.size;
    const offset = framing.offset;
    let first = 0;
    let run = 0;
    let peak = 0;
    let energy = 0;
    for (let n = 0; n <= block; n += 1) {
      if (n < block && this.#quiet(n)) {
        if (run === 0) first = n;
        run += 1;
        for (let channel = 0; channel < framing.channels; channel += 1) {
          const sample = framing.samples(channel)[offset + n] ?? 0;
          const magnitude = Math.abs(sample);
          if (magnitude > peak) peak = magnitude;
          energy += sample * sample;
        }
        continue;
      }
      if (run > 0) this.#events.append(framing.position + first, run, peak, energy);
      run = 0;
      peak = 0;
      energy = 0;
    }
  }
}
