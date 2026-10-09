/**
 * Transient features, as `transients.rs` extracts them: per STFT frame and
 * channel, the flux `Σ max(mₖ − m′ₖ, 0)` over magnitudes
 * `mₖ = (4 · √(re · re + im · im)) / N`, and the threshold
 * `offset + multiplier · median` of the last `history` frames' flux, copied
 * oldest first and found by the canonical selection (ADR-0032).
 */

import type { FeatureExtractor } from './feature-extractor.js';
import { rankAt, selectRank } from './selection.js';
import { ReferenceStft } from './stft.js';

/** How a transient extractor's threshold follows the flux. */
export interface TransientThreshold {
  readonly history: number;
  readonly multiplier: number;
  readonly offset: number;
}

/** Each channel's spectral flux and its threshold, the settings already checked. */
export class ReferenceTransients implements FeatureExtractor {
  readonly recordWidth: number;
  readonly #stft: ReferenceStft;
  readonly #threshold: TransientThreshold;
  readonly #real: Float64Array;
  readonly #imaginary: Float64Array;
  /** Per channel, the previous frame's magnitudes. */
  readonly #previous: Float64Array;
  /** Per channel, the last `history` frames' flux, a ring. */
  readonly #fluxes: Float64Array;
  #next = 0;
  #held = 0;
  readonly #scratch: Float64Array;

  constructor(channels: number, size: number, hop: number, threshold: TransientThreshold) {
    this.recordWidth = 2 * channels;
    this.#stft = new ReferenceStft(channels, size, hop);
    this.#threshold = threshold;
    const bins = this.#stft.bins;
    this.#real = new Float64Array(channels * bins);
    this.#imaginary = new Float64Array(channels * bins);
    this.#previous = new Float64Array(channels * bins);
    this.#fluxes = new Float64Array(channels * threshold.history);
    this.#scratch = new Float64Array(threshold.history);
  }

  push(input: readonly Float32Array[], frames: number): void {
    this.#stft.push(input, frames);
  }

  pull(into: Float64Array): number {
    const capacity = Math.floor(into.length / this.recordWidth);
    const { history, multiplier, offset } = this.#threshold;
    const bins = this.#stft.bins;
    const size = this.#stft.size;
    let written = 0;
    while (written < capacity && this.#stft.pullComplex(this.#real, this.#imaginary)) {
      this.#held = Math.min(this.#held + 1, history);
      for (let channel = 0; channel < this.#stft.channels; channel += 1) {
        let flux = 0;
        for (let index = channel * bins; index < (channel + 1) * bins; index += 1) {
          const re = this.#real[index] ?? 0;
          const im = this.#imaginary[index] ?? 0;
          const magnitude = (4 * Math.sqrt(re * re + im * im)) / size;
          const rise = magnitude - (this.#previous[index] ?? 0);
          flux += rise > 0 ? rise : 0;
          this.#previous[index] = magnitude;
        }
        const ring = channel * history;
        this.#fluxes[ring + this.#next] = flux;
        const oldest = (this.#next + history + 1 - this.#held) % history;
        for (let index = 0; index < this.#held; index += 1) {
          this.#scratch[index] = this.#fluxes[ring + ((oldest + index) % history)] ?? 0;
        }
        const rank = rankAt(this.#held, 0.5);
        selectRank(this.#scratch, this.#held, rank);
        const median = this.#scratch[rank] ?? 0;
        into[written * this.recordWidth + 2 * channel] = flux;
        into[written * this.recordWidth + 2 * channel + 1] = offset + multiplier * median;
      }
      this.#next = (this.#next + 1) % history;
      written += 1;
    }
    return written;
  }
}
