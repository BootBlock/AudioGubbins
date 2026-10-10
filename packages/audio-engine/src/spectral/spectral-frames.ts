/**
 * The frames a spectral edit is realised in (ADR-0081): where each lies, and
 * the transform into a spectrum and back.
 *
 * Frame `k` of a stream is centred at sample `k · H` of it, `H` being the
 * resolution `N` over the quality's spectral overlap, and holds the `N`
 * samples from `k · H − N/2`, silence where they lie outside the stream. A
 * frame is windowed by the square root of the periodic Hann window, the
 * engine's `vocoderWindow`, before its forward transform, and its change is
 * windowed again after the inverse and scaled by `2 · H / N`, so the copies
 * of the Hann window that the two make sum to one at every sample: an
 * unchanged frame adds nothing, and a change applied alike to every frame is
 * heard at the level it states. Only the canonical FFT and correctly rounded
 * arithmetic are used (ADR-0032), so the reference and the WebAssembly DSP
 * give the same bits.
 */

import type { CanonicalFft } from '../dsp/canonical-dsp.js';
import { vocoderWindow } from '../dsp/phase-locking.js';

/** Where a stream's frames lie: their length, their hop and the frames that touch the stream. */
export class FrameGeometry {
  /** `N`. */
  readonly size: number;
  /** `H`. */
  readonly hop: number;
  /** `N/2 + 1`. */
  readonly bins: number;
  readonly length: number;

  constructor(size: number, overlap: number, length: number) {
    this.size = size;
    this.hop = size / overlap;
    this.bins = size / 2 + 1;
    this.length = length;
  }

  /** The sample frame `k` is centred on. */
  centre(k: number): number {
    return k * this.hop;
  }

  /** The first sample frame `k` holds. */
  first(k: number): number {
    return k * this.hop - this.size / 2;
  }

  /** The first frame that holds a sample at or after `position`. */
  firstReaching(position: number): number {
    return Math.floor((position - this.size / 2) / this.hop) + 1;
  }

  /** The last frame that begins before `position`. */
  lastBefore(position: number): number {
    return Math.ceil((position + this.size / 2) / this.hop) - 1;
  }

  /** Whether frame `k` holds only samples of the stream, none of the silence outside it. */
  within(k: number): boolean {
    const first = this.first(k);
    return first >= 0 && first + this.size <= this.length;
  }

  /** The first frame that holds any of the stream. */
  get firstFrame(): number {
    return this.firstReaching(0);
  }

  /** The last frame that holds any of the stream. */
  get lastFrame(): number {
    return this.lastBefore(this.length);
  }
}

/** The forward and inverse transform of one frame, with the scratch it is worked in. */
export class FrameTransform {
  readonly geometry: FrameGeometry;
  readonly #fft: CanonicalFft;
  readonly #window: Float64Array;
  /** The window after the inverse, times `2 · H / N`. */
  readonly #synthesis: Float64Array;
  readonly #signal: Float64Array;

  constructor(geometry: FrameGeometry, fft: CanonicalFft) {
    this.geometry = geometry;
    this.#fft = fft;
    this.#window = vocoderWindow(geometry.size);
    const scale = (2 * geometry.hop) / geometry.size;
    this.#synthesis = this.#window.map((weight) => weight * scale);
    this.#signal = new Float64Array(geometry.size);
  }

  /**
   * Writes the spectrum of the frame whose samples begin at `offset` of
   * `samples`, windowed, to `real` and `imaginary`.
   */
  analyse(
    samples: Float32Array,
    offset: number,
    real: Float64Array,
    imaginary: Float64Array,
  ): void {
    const signal = this.#signal;
    const window = this.#window;
    for (let n = 0; n < signal.length; n += 1) {
      signal[n] = (samples[offset + n] ?? 0) * (window[n] ?? 0);
    }
    this.#fft.forwardReal(signal, real, imaginary);
  }

  /**
   * Adds the frame whose change is `real` and `imaginary`, returned to
   * samples and windowed, into `sums` from `offset` of the frame: sample
   * `n` of the frame, from `from` on, into `sums[offset + n]`.
   */
  synthesise(
    real: Float64Array,
    imaginary: Float64Array,
    sums: Float64Array,
    offset: number,
    from: number,
  ): void {
    const signal = this.#signal;
    const synthesis = this.#synthesis;
    this.#fft.inverseReal(real, imaginary, signal);
    const end = Math.min(signal.length, sums.length - offset);
    for (let n = from; n < end; n += 1) {
      const at = offset + n;
      sums[at] = (sums[at] ?? 0) + (signal[n] ?? 0) * (synthesis[n] ?? 0);
    }
  }

  release(): void {
    this.#fft.release();
  }
}
