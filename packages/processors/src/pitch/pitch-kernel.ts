/**
 * The pitch shift's kernel: a stream pushed through frames of `N` samples,
 * `H = N/O` apart, each shifted (`peak-shift.ts`) and overlap-added back at
 * the hop it was analysed at, so the stream keeps its length and its frames
 * their places.
 *
 * Sample `t` is written to each channel's history, read through `finiteSample`.
 * When `t` ends a hop, counted from the kernel's first sample, so the first
 * frame ends at sample `H − 1`, the `N` samples up to it are windowed by the
 * vocoder's window, transformed by the canonical FFT, shifted at the ratio of
 * that frame, returned by the inverse, windowed again, scaled by `2/O` and
 * added into what waits to be written. Then the sample `N − 1` before `t` is
 * written out: every frame that holds it, the last ending `N − 1` samples after
 * it, has been added in, so the latency is `N − 1`. Before the stream the
 * history is silence, and the window's copies sum to `O/2` from the stream's
 * first sample.
 *
 * The ratio is `2^((s + c/100) / 12)` for the semitones `s` and cents `c` the
 * ramps hold at the sample that ends the frame, so a move is heard frame by
 * frame and the bits do not depend on how the stream is cut into blocks.
 */

import {
  channelAt,
  portAt,
  pow,
  type AudioFrameBlock,
  type CanonicalFft,
  type NodeKernel,
} from '@audiogubbins/audio-engine';
import type { DomainResult } from '@audiogubbins/domain';

import { finiteSample } from '../framework/sample-safety.js';
import type { RampedParameters } from '../dynamics/ramped-parameters.js';
import { PeakShift } from './peak-shift.js';

/** What a pitch shift's kernel is made of. */
export interface PitchKernelParts {
  readonly fft: CanonicalFft;
  readonly window: Float64Array;
  readonly overlap: number;
  readonly channels: number;
  readonly ramps: RampedParameters;
  /** The keys of the semitones and the cents among the ramps. */
  readonly semitones: string;
  readonly cents: string;
}

/** A stream shifted in pitch, `N − 1` frames late. */
export class PitchKernel implements NodeKernel {
  readonly #parts: PitchKernelParts;
  readonly #size: number;
  readonly #hop: number;
  readonly #shift: PeakShift;
  /** Each channel's last `N` samples, a ring whose oldest is at `#position`. */
  readonly #history: readonly Float64Array[];
  /** Each channel's sum of the frames made so far, read and cleared at `#position`. */
  readonly #pending: readonly Float64Array[];
  readonly #frame: Float64Array;
  /** The window after the inverse, times `2/O`. */
  readonly #synthesis: Float64Array;
  readonly #semitones: Float64Array;
  readonly #cents: Float64Array;
  #position = 0;
  #sinceFrame = 0;

  constructor(parts: PitchKernelParts) {
    const size = parts.fft.size;
    this.#parts = parts;
    this.#size = size;
    this.#hop = size / parts.overlap;
    this.#shift = new PeakShift(size, this.#hop, parts.channels);
    const rings = () => Array.from({ length: parts.channels }, () => new Float64Array(size));
    this.#history = rings();
    this.#pending = rings();
    this.#frame = new Float64Array(size);
    this.#synthesis = parts.window.map((weight) => (weight * 2) / parts.overlap);
    this.#semitones = parts.ramps.frames(parts.semitones);
    this.#cents = parts.ramps.frames(parts.cents);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    this.#parts.ramps.advance(frames);
    const mask = this.#size - 1;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < this.#history.length; channel += 1) {
        const history = this.#history[channel];
        if (history !== undefined) {
          history[this.#position] = finiteSample(channelAt(input, channel)[frame] ?? 0);
        }
      }
      this.#position = (this.#position + 1) & mask;
      this.#sinceFrame += 1;
      if (this.#sinceFrame === this.#hop) {
        this.#sinceFrame = 0;
        this.#synthesise(frame);
      }
      this.#emit(output, frame);
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    return this.#parts.ramps.set(name, value);
  }

  release(): void {
    this.#parts.fft.release();
  }

  /** The frame that ends at frame `frame` of the block, shifted and added into the waiting sums. */
  #synthesise(frame: number): void {
    const { fft, window } = this.#parts;
    const shift = this.#shift;
    const size = this.#size;
    const mask = size - 1;
    const position = this.#position;
    // The cents as hundredths of a semitone added to the semitones, then octaves.
    shift.ratio[0] = pow(2, ((this.#semitones[frame] ?? 0) + (this.#cents[frame] ?? 0) / 100) / 12);
    const signal = this.#frame;
    for (let channel = 0; channel < this.#history.length; channel += 1) {
      const history = this.#history[channel];
      const real = shift.real[channel];
      const imaginary = shift.imaginary[channel];
      if (history === undefined || real === undefined || imaginary === undefined) continue;
      for (let n = 0; n < size; n += 1) {
        signal[n] = (history[(position + n) & mask] ?? 0) * (window[n] ?? 0);
      }
      fft.forwardReal(signal, real, imaginary);
    }
    shift.shift();
    const synthesis = this.#synthesis;
    for (let channel = 0; channel < this.#pending.length; channel += 1) {
      const pending = this.#pending[channel];
      const real = shift.shiftedReal[channel];
      const imaginary = shift.shiftedImaginary[channel];
      if (pending === undefined || real === undefined || imaginary === undefined) continue;
      fft.inverseReal(real, imaginary, signal);
      for (let n = 0; n < size; n += 1) {
        const slot = (position + n) & mask;
        pending[slot] = (pending[slot] ?? 0) + (signal[n] ?? 0) * (synthesis[n] ?? 0);
      }
    }
  }

  /** Writes frame `frame` of every channel from the oldest waiting sum, and clears it. */
  #emit(output: AudioFrameBlock, frame: number): void {
    const position = this.#position;
    for (let channel = 0; channel < this.#pending.length; channel += 1) {
      const pending = this.#pending[channel];
      if (pending === undefined) continue;
      channelAt(output, channel)[frame] = pending[position] ?? 0;
      pending[position] = 0;
    }
  }
}
