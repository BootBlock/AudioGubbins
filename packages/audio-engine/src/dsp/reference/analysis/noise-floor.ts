/**
 * Noise floor features, as `noise_floor.rs` extracts them: per frame and
 * channel, the level `gainToDecibels(√((Σ x · x) / frame))`, and the floor,
 * the level at `percentile` of the last `history` levels, copied oldest
 * first and found by the canonical selection at nearest rank (ADR-0032).
 */

import { gainToDecibels } from '../decibels.js';
import type { FeatureExtractor } from './feature-extractor.js';
import { ReferenceFraming } from './framing.js';
import { rankAt, selectRank } from './selection.js';

/** Each channel's level and noise floor, the settings already checked. */
export class ReferenceNoiseFloor implements FeatureExtractor {
  readonly recordWidth: number;
  readonly #framing: ReferenceFraming;
  readonly #percentile: number;
  readonly #history: number;
  /** Per channel, the last `history` levels, a ring. */
  readonly #levels: Float64Array;
  #next = 0;
  #held = 0;
  readonly #scratch: Float64Array;

  constructor(channels: number, frame: number, hop: number, percentile: number, history: number) {
    this.recordWidth = 2 * channels;
    this.#framing = new ReferenceFraming(channels, frame, hop);
    this.#percentile = percentile;
    this.#history = history;
    this.#levels = new Float64Array(channels * history);
    this.#scratch = new Float64Array(history);
  }

  push(input: readonly Float32Array[], frames: number): void {
    this.#framing.push(input, frames);
  }

  pull(into: Float64Array): number {
    const framing = this.#framing;
    const channels = framing.channels;
    const history = this.#history;
    const capacity = Math.floor(into.length / this.recordWidth);
    let written = 0;
    while (written < capacity && framing.ready) {
      this.#held = Math.min(this.#held + 1, history);
      const offset = framing.offset;
      for (let channel = 0; channel < channels; channel += 1) {
        const samples = framing.samples(channel);
        let sum = 0;
        for (let n = 0; n < framing.size; n += 1) {
          const value = samples[offset + n] ?? 0;
          sum += value * value;
        }
        const level = gainToDecibels(Math.sqrt(sum / framing.size));
        const ring = channel * history;
        this.#levels[ring + this.#next] = level;
        const oldest = (this.#next + history + 1 - this.#held) % history;
        for (let index = 0; index < this.#held; index += 1) {
          this.#scratch[index] = this.#levels[ring + ((oldest + index) % history)] ?? 0;
        }
        const at = written * this.recordWidth + 2 * channel;
        into[at] = level;
        const rank = rankAt(this.#held, this.#percentile);
        selectRank(this.#scratch, this.#held, rank);
        into[at + 1] = this.#scratch[rank] ?? 0;
      }
      this.#next = (this.#next + 1) % history;
      framing.advance();
      written += 1;
    }
    return written;
  }
}
