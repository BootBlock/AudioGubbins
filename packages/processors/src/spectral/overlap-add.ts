/**
 * The spectral processors' short-time Fourier transform heard again: each
 * frame of `frame-analysis.ts` changed by a processor's transform, returned to
 * samples by the canonical inverse FFT, windowed a second time by the square
 * root of the periodic Hann window, scaled by `2 · hop / N` and added into
 * what is waiting to be written.
 *
 * Sample `t` of the stream is written `N − 1` samples later, the latency of
 * both spectral processors: by then every frame that holds it, the last ending
 * at most `N − 1` samples after it, has been added in. Each sample of the block
 * is written to the history first, then the frame that ends with it is made,
 * then the oldest waiting sample is written out, so a frame's first sample is
 * heard as the frame is made. With a transform that changes nothing, every
 * sample from the stream's first is its input, delayed, to the rounding of the
 * transforms, since the Hann window's copies `hop` apart sum to `N / (2 · hop)`
 * for a hop of `N / 2` or less.
 */

import { channelAt, type AudioFrameBlock } from '@audiogubbins/audio-engine';

import type { FrameAnalysis } from './frame-analysis.js';

/** What a spectral processor does to each frame. */
export interface SpectralTransform {
  /**
   * Changes, in place, the spectra of the analysis's latest frame, which ends
   * at frame `frame` of the block being processed.
   */
  transform(frame: number): void;
}

/** A stream through a short-time Fourier transform, a spectral change, and back. */
export class OverlapAdd {
  readonly analysis: FrameAnalysis;
  /** Each channel's sum of the frames made so far, a ring read and cleared at the analysis's position. */
  readonly #pending: readonly Float64Array[];
  readonly #signal: Float64Array;
  /** The window after the inverse, times `2 · hop / N`. */
  readonly #synthesis: Float64Array;

  constructor(analysis: FrameAnalysis) {
    this.analysis = analysis;
    const { size, hop, channels } = analysis;
    this.#pending = Array.from({ length: channels }, () => new Float64Array(size));
    this.#signal = new Float64Array(size);
    this.#synthesis = analysis.window.map((weight) => (weight * 2 * hop) / size);
  }

  /** Writes `frames` frames of `input`, through `transform` and delayed by `N − 1`, to `output`. */
  process(
    input: AudioFrameBlock,
    output: AudioFrameBlock,
    frames: number,
    transform: SpectralTransform,
  ): void {
    const analysis = this.analysis;
    for (let frame = 0; frame < frames; frame += 1) {
      if (analysis.push(input.channels, frame)) {
        analysis.analyse();
        transform.transform(frame);
        this.#synthesise();
      }
      // The analysis's position is now the oldest sample's, `N − 1` before the
      // one just written, and every frame that holds it has been added in.
      this.#emit(output, frame, analysis.position);
    }
  }

  /**
   * Writes frame `frame` of every channel of `output` from slot `slot` of the
   * waiting sums, the oldest, and clears the slot for the frame that next
   * reaches it.
   */
  #emit(output: AudioFrameBlock, frame: number, slot: number): void {
    for (let channel = 0; channel < this.analysis.channels; channel += 1) {
      const pending = this.#pending[channel];
      if (pending === undefined) continue;
      channelAt(output, channel)[frame] = pending[slot] ?? 0;
      pending[slot] = 0;
    }
  }

  /** Every channel's latest frame, returned to samples, windowed and added into the waiting sums. */
  #synthesise(): void {
    const { size, fft, position } = this.analysis;
    const mask = size - 1;
    const signal = this.#signal;
    const synthesis = this.#synthesis;
    for (let channel = 0; channel < this.analysis.channels; channel += 1) {
      const pending = this.#pending[channel];
      const real = this.analysis.real[channel];
      const imaginary = this.analysis.imaginary[channel];
      if (pending === undefined || real === undefined || imaginary === undefined) continue;
      fft.inverseReal(real, imaginary, signal);
      for (let n = 0; n < size; n += 1) {
        const slot = (position + n) & mask;
        pending[slot] = (pending[slot] ?? 0) + (signal[n] ?? 0) * (synthesis[n] ?? 0);
      }
    }
  }
}
