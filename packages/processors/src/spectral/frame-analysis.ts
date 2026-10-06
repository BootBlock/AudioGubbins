/**
 * The analysis half of the spectral processors' short-time Fourier transform,
 * framed here because the canonical STFT (`createStft`) gives no inverse and
 * windows by the periodic Hann window, where a transform heard again needs a
 * window on both sides.
 *
 * - The window is the square root of the periodic Hann window, the engine's
 *   `vocoderWindow`, which the stretch and the pitch shift frame by too.
 *   Applied once before the transform and once after the inverse, the two make
 *   the Hann window, whose copies `hop` apart sum to `N / (2 · hop)` at every
 *   sample for a hop of `N / 2` or less, so `overlap-add.ts` scales by
 *   `2 · hop / N`.
 * - A frame ends at every `hop`-th sample of the stream, the first at sample
 *   `hop − 1`, and holds the `N` samples up to it, the oldest first; before the
 *   stream the history is silence.
 * - Each sample is read through `finiteSample` as it is written.
 *
 * Its state is the history and two counters, advanced a sample at a time, so
 * the frames do not depend on how the stream is cut into blocks.
 */

import { vocoderWindow, type CanonicalFft } from '@audiogubbins/audio-engine';

import { finiteSample } from '../framework/sample-safety.js';

/** The latest frame of every channel of a stream, windowed and transformed. */
export class FrameAnalysis {
  readonly size: number;
  readonly hop: number;
  readonly bins: number;
  readonly channels: number;
  readonly window: Float64Array;
  /** Each channel's spectrum of the latest frame, `bins` long, which a transform may change. */
  readonly real: readonly Float64Array[];
  readonly imaginary: readonly Float64Array[];
  readonly fft: CanonicalFft;
  /** Each channel's last `size` samples, a ring whose oldest sample is at {@link position}. */
  readonly #history: readonly Float64Array[];
  readonly #signal: Float64Array;
  #position = 0;
  #sinceFrame = 0;
  /** Samples of the stream the history holds, up to `size`. */
  #filled = 0;

  /** The analysis of `channels` channels by `fft`, a frame every `hop` samples. */
  constructor(fft: CanonicalFft, channels: number, hop: number) {
    this.fft = fft;
    this.size = fft.size;
    this.bins = fft.bins;
    this.hop = hop;
    this.channels = channels;
    this.window = vocoderWindow(fft.size);
    const each = (length: number) =>
      Array.from({ length: channels }, () => new Float64Array(length));
    this.real = each(fft.bins);
    this.imaginary = each(fft.bins);
    this.#history = each(fft.size);
    this.#signal = new Float64Array(fft.size);
  }

  /** Where the oldest sample of every channel's history is, and where the next is written. */
  get position(): number {
    return this.#position;
  }

  /** Whether the history holds `size` samples of the stream, none of the silence before it. */
  get full(): boolean {
    return this.#filled === this.size;
  }

  /**
   * Writes sample `frame` of every channel of `input` into the history, and
   * answers whether a frame ends with it. A channel `input` lacks is silence.
   */
  push(input: readonly Float32Array[], frame: number): boolean {
    const position = this.#position;
    for (let channel = 0; channel < this.channels; channel += 1) {
      const samples = input[channel];
      const history = this.#history[channel];
      if (history === undefined) continue;
      history[position] = samples === undefined ? 0 : finiteSample(samples[frame] ?? 0);
    }
    this.#position = position + 1 === this.size ? 0 : position + 1;
    if (this.#filled < this.size) this.#filled += 1;
    this.#sinceFrame += 1;
    if (this.#sinceFrame < this.hop) return false;
    this.#sinceFrame = 0;
    return true;
  }

  /** The spectrum of every channel's last `size` samples, windowed, into `real` and `imaginary`. */
  analyse(): void {
    const { size, window } = this;
    const mask = size - 1;
    const signal = this.#signal;
    for (let channel = 0; channel < this.channels; channel += 1) {
      const history = this.#history[channel];
      const real = this.real[channel];
      const imaginary = this.imaginary[channel];
      if (history === undefined || real === undefined || imaginary === undefined) continue;
      for (let n = 0; n < size; n += 1) {
        signal[n] = (history[(this.#position + n) & mask] ?? 0) * (window[n] ?? 0);
      }
      this.fft.forwardReal(signal, real, imaginary);
    }
  }

  release(): void {
    this.fft.release();
  }
}
