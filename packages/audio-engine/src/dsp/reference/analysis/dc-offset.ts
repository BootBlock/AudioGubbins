/**
 * DC offset features, as `dc_offset.rs` extracts them: per frame of `window`
 * samples, `hop` apart, each channel's `(Σ x[n]) / window`, summed from the
 * frame's first sample (ADR-0032).
 */

import type { FeatureExtractor } from './feature-extractor.js';
import { ReferenceFraming } from './framing.js';

/** The running mean of each channel, the settings already checked. */
export class ReferenceDcOffset implements FeatureExtractor {
  readonly recordWidth: number;
  readonly #framing: ReferenceFraming;

  constructor(channels: number, window: number, hop: number) {
    this.recordWidth = channels;
    this.#framing = new ReferenceFraming(channels, window, hop);
  }

  push(input: readonly Float32Array[], frames: number): void {
    this.#framing.push(input, frames);
  }

  pull(into: Float64Array): number {
    const framing = this.#framing;
    const channels = framing.channels;
    const capacity = Math.floor(into.length / channels);
    let written = 0;
    while (written < capacity && framing.ready) {
      const offset = framing.offset;
      for (let channel = 0; channel < channels; channel += 1) {
        const samples = framing.samples(channel);
        let sum = 0;
        for (let n = 0; n < framing.size; n += 1) sum += samples[offset + n] ?? 0;
        into[written * channels + channel] = sum / framing.size;
      }
      framing.advance();
      written += 1;
    }
    return written;
  }
}
