/**
 * Click features, as `clicks.rs` extracts them: per block and channel, an
 * order-16 prediction-error filter fitted by Burg's method, each sample's
 * residual `Σ a[i] · x[n − i]` (zero for the stream's first 16 samples), and
 * an event `[channel, sample, e − m, MAD]` where the deviation from the
 * median `m` is above `sensitivity · MAD` and 2⁻²⁴ (ADR-0032).
 */

import { ReferenceBurg } from './burg.js';
import { EventQueue } from './event-queue.js';
import type { FeatureExtractor } from './feature-extractor.js';
import { ReferenceFraming } from './framing.js';
import { rankAt, selectRank } from './selection.js';

/** The predictor's order: `PREDICTOR_ORDER` in `clicks.rs`. */
const ORDER = 16;

/** The least deviation an event has: 2⁻²⁴. */
const LEAST_DEVIATION = 1 / 16_777_216;

/** Residuals and their robust local threshold, the settings already checked. */
export class ReferenceClicks implements FeatureExtractor {
  readonly recordWidth = 4;
  readonly #framing: ReferenceFraming;
  readonly #sensitivity: number;
  /** Per channel, the last 16 samples before the next block, newest first. */
  readonly #before: Float64Array[];
  readonly #burg: ReferenceBurg;
  readonly #coefficients = new Float64Array(ORDER + 1);
  readonly #samples: Float64Array;
  readonly #residuals: Float64Array;
  readonly #ordered: Float64Array;
  readonly #events = new EventQueue();

  constructor(channels: number, block: number, sensitivity: number) {
    this.#framing = new ReferenceFraming(channels, block, block);
    this.#sensitivity = sensitivity;
    this.#before = Array.from({ length: channels }, () => new Float64Array(ORDER));
    this.#burg = new ReferenceBurg(ORDER, block);
    this.#samples = new Float64Array(block);
    this.#residuals = new Float64Array(block);
    this.#ordered = new Float64Array(block);
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
        this.#analyse(channel);
      }
      this.#framing.advance();
    }
  }

  /** Queues the events of one channel's next block and keeps its last samples; `analyse`. */
  #analyse(channel: number): void {
    const framing = this.#framing;
    const block = framing.size;
    const start = framing.position;
    const offset = framing.offset;
    const source = framing.samples(channel);
    const history = this.#before[channel] ?? new Float64Array(ORDER);
    const samples = this.#samples;
    const residuals = this.#residuals;
    const ordered = this.#ordered;
    for (let n = 0; n < block; n += 1) samples[n] = source[offset + n] ?? 0;
    this.#burg.fit(samples, this.#coefficients);
    const unprimed = Math.max(ORDER - start, 0);
    for (let n = 0; n < block; n += 1) {
      if (n < unprimed) {
        residuals[n] = 0;
        continue;
      }
      let residual = 0;
      for (let lag = 0; lag <= ORDER; lag += 1) {
        const input = lag <= n ? (samples[n - lag] ?? 0) : (history[lag - n - 1] ?? 0);
        residual += (this.#coefficients[lag] ?? 0) * input;
      }
      residuals[n] = residual;
    }
    const rank = rankAt(block, 0.5);
    ordered.set(residuals);
    selectRank(ordered, block, rank);
    const median = ordered[rank] ?? 0;
    for (let n = 0; n < block; n += 1) ordered[n] = Math.abs((residuals[n] ?? 0) - median);
    selectRank(ordered, block, rank);
    const deviation = ordered[rank] ?? 0;
    const threshold = this.#sensitivity * deviation;
    for (let n = 0; n < block; n += 1) {
      const away = (residuals[n] ?? 0) - median;
      const magnitude = Math.abs(away);
      if (magnitude > threshold && magnitude > LEAST_DEVIATION) {
        this.#events.append(channel, start + n, away, deviation);
      }
    }
    for (let lag = 0; lag < ORDER; lag += 1) history[lag] = samples[block - 1 - lag] ?? 0;
  }
}
