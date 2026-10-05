/**
 * Clipping features, as `clipping.rs` extracts them: per block and channel,
 * the largest magnitude `M`, and an event `[channel, first sample, length, M]`
 * for each run of at least `minimumRun` samples whose magnitude is at least
 * `M − epsilon`; a silent block has none (ADR-0032).
 */

import { EventQueue } from './event-queue.js';
import type { FeatureExtractor } from './feature-extractor.js';
import { ReferenceFraming } from './framing.js';

/** Runs at each block's largest magnitude, the settings already checked. */
export class ReferenceClipping implements FeatureExtractor {
  readonly recordWidth = 4;
  readonly #framing: ReferenceFraming;
  readonly #epsilon: number;
  readonly #minimumRun: number;
  readonly #events = new EventQueue();

  constructor(channels: number, block: number, epsilon: number, minimumRun: number) {
    this.#framing = new ReferenceFraming(channels, block, block);
    this.#epsilon = epsilon;
    this.#minimumRun = minimumRun;
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
      for (let channel = 0; channel < this.#framing.channels; channel += 1) {
        this.#runsOf(channel);
      }
      this.#framing.advance();
    }
  }

  /** Queues the events of one channel's next block; `runs_of`. */
  #runsOf(channel: number): void {
    const framing = this.#framing;
    const block = framing.size;
    const offset = framing.offset;
    const samples = framing.samples(channel);
    let largest = 0;
    for (let n = 0; n < block; n += 1) {
      const magnitude = Math.abs(samples[offset + n] ?? 0);
      if (magnitude > largest) largest = magnitude;
    }
    if (largest <= 0) return;
    const threshold = largest - this.#epsilon;
    let run = 0;
    for (let n = 0; n <= block; n += 1) {
      if (n < block && Math.abs(samples[offset + n] ?? 0) >= threshold) {
        run += 1;
        continue;
      }
      if (run >= this.#minimumRun) {
        this.#events.append(channel, framing.position + (n - run), run, largest);
      }
      run = 0;
    }
  }
}
