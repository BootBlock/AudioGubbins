/**
 * The frame transform of a phase vocoder with identity phase locking
 * (Laroche and Dolson, 1999): one windowed frame of input in, one frame of
 * output to overlap-add out, its partials moved on by the synthesis hop
 * whatever hop the analysis took. A stretch is built on it. Its window, its
 * peaks and their regions are the ones the pitch shift locks its phases by
 * (`phase-locking.ts`).
 *
 * A frame keeps the input's magnitudes. A peak's phase advances by its
 * measured frequency over the synthesis hop, and every bin of a peak's
 * region keeps its analysed phase relative to the peak, which keeps a
 * partial's shape and a transient's attack far better than a phase per bin.
 * Both windows are square-rooted Hann windows, so the overlap-add of `O`
 * frames sums to `O/2`, and each output frame is scaled by `2/O`.
 *
 * Every step is canonical: the FFT is the engine's, the angles are the
 * reference primitives', and the rest is IEEE arithmetic in one order, so
 * every thread makes the same bits.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import type { CanonicalDsp, CanonicalFft } from './canonical-dsp.js';
import { findPeaks, regionEnd, vocoderWindow } from './phase-locking.js';
import { sineOfTurns } from './reference/primitives.js';
import { arctangentTurns, cosineOfTurns } from './reference/trigonometry.js';

/** One channel's phases between frames. */
interface ChannelPhases {
  /** The previous frame's analysed phases, in turns. */
  readonly analysed: Float64Array;
  /** The previous frame's synthesis phases, in turns, each in `[0, 1)`. */
  readonly synthesised: Float64Array;
}

/** A phase vocoder's frame transform for a number of channels, with its scratch made once. */
export class PhaseVocoder {
  /** The frame's length, `N`. */
  readonly size: number;
  /** The synthesis hop, `N/O`. */
  readonly hop: number;
  readonly #overlap: number;
  readonly #fft: CanonicalFft;
  readonly #window: Float64Array;
  readonly #real: Float64Array;
  readonly #imaginary: Float64Array;
  readonly #magnitude: Float64Array;
  readonly #phase: Float64Array;
  readonly #frame: Float64Array;
  readonly #peaks: Int32Array;
  readonly #channels: readonly ChannelPhases[];

  private constructor(fft: CanonicalFft, overlap: number, channels: number) {
    const size = fft.size;
    const bins = fft.bins;
    this.size = size;
    this.hop = size / overlap;
    this.#overlap = overlap;
    this.#fft = fft;
    this.#window = vocoderWindow(size);
    this.#real = new Float64Array(bins);
    this.#imaginary = new Float64Array(bins);
    this.#magnitude = new Float64Array(bins);
    this.#phase = new Float64Array(bins);
    this.#frame = new Float64Array(size);
    this.#peaks = new Int32Array(bins);
    this.#channels = Array.from({ length: channels }, () => ({
      analysed: new Float64Array(bins),
      synthesised: new Float64Array(bins),
    }));
  }

  /**
   * A vocoder of frames of `size` samples, a power of two the FFT takes,
   * overlapping `overlap` times, for `channels` channels; or why not.
   */
  static create(
    dsp: CanonicalDsp,
    size: number,
    overlap: number,
    channels: number,
  ): DomainResult<PhaseVocoder> {
    const fft = dsp.createFft(size);
    if (!fft.ok) return fft;
    return succeed(new PhaseVocoder(fft.value, overlap, channels));
  }

  /**
   * Transforms one frame of `channel`: `input`, the `N` samples under the
   * analysis window, `analysisHop` samples after the channel's last frame, or
   * `undefined` for a first frame, which takes its analysed phases as they
   * are. Adds the output frame to `output`, `N` samples.
   */
  transform(
    channel: number,
    input: Float32Array,
    analysisHop: number | undefined,
    output: Float64Array,
  ): void {
    const phases = this.#channels[channel];
    if (phases === undefined) throw new Error('A vocoder transforms only its own channels.');
    const size = this.size;
    const bins = this.#fft.bins;
    const frame = this.#frame;
    const window = this.#window;
    for (let n = 0; n < size; n += 1) frame[n] = (input[n] ?? 0) * (window[n] ?? 0);
    this.#fft.forwardReal(frame, this.#real, this.#imaginary);
    const magnitude = this.#magnitude;
    const phase = this.#phase;
    for (let k = 0; k < bins; k += 1) {
      const re = this.#real[k] ?? 0;
      const im = this.#imaginary[k] ?? 0;
      magnitude[k] = Math.sqrt(re * re + im * im);
      phase[k] = arctangentTurns(im, re);
    }
    if (analysisHop === undefined) {
      for (let k = 0; k < bins; k += 1) phases.synthesised[k] = wrapped(phase[k] ?? 0);
    } else {
      const peakCount = findPeaks(magnitude, bins, this.#peaks);
      this.#advance(phases, peakCount, bins, analysisHop);
    }
    phases.analysed.set(phase);
    for (let k = 0; k < bins; k += 1) {
      const amount = magnitude[k] ?? 0;
      const turns = phases.synthesised[k] ?? 0;
      this.#real[k] = amount * cosineOfTurns(turns);
      this.#imaginary[k] = amount * sineOfTurns(turns);
    }
    this.#fft.inverseReal(this.#real, this.#imaginary, frame);
    const scale = 2 / this.#overlap;
    for (let n = 0; n < size; n += 1) {
      output[n] = (output[n] ?? 0) + (frame[n] ?? 0) * (window[n] ?? 0) * scale;
    }
  }

  /**
   * Each peak's phase advanced by its measured frequency over the synthesis
   * hop, and each bin of its region, the bins nearer it than any other peak,
   * set at its analysed distance from the peak.
   */
  #advance(phases: ChannelPhases, peakCount: number, bins: number, analysisHop: number): void {
    const phase = this.#phase;
    let regionStart = 0;
    for (let index = 0; index < peakCount; index += 1) {
      const peak = this.#peaks[index] ?? 0;
      const end = regionEnd(this.#peaks, index, peakCount, bins);
      const centre = peak / this.size;
      let frequency = centre;
      if (analysisHop > 0) {
        const expected = (phase[peak] ?? 0) - (phases.analysed[peak] ?? 0) - analysisHop * centre;
        frequency = centre + (expected - Math.round(expected)) / analysisHop;
      }
      const peakPhase = wrapped((phases.synthesised[peak] ?? 0) + this.hop * frequency);
      const peakAnalysed = phase[peak] ?? 0;
      for (let k = regionStart; k < end; k += 1) {
        phases.synthesised[k] = wrapped(peakPhase + (phase[k] ?? 0) - peakAnalysed);
      }
      regionStart = end;
    }
    for (let k = regionStart; k < bins; k += 1) phases.synthesised[k] = wrapped(phase[k] ?? 0);
  }

  release(): void {
    this.#fft.release();
  }
}

/** `turns` in `[0, 1)`, so a phase that advances for ever keeps its precision. */
function wrapped(turns: number): number {
  return turns - Math.floor(turns);
}
