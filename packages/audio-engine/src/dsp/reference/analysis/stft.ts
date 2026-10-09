/**
 * The short-time Fourier transform, as `stft.rs` computes it, operation for
 * operation: each frame's samples times the periodic Hann window
 * `0.5 − 0.5 · cosineOfTurns(n / N)`, transformed by the canonical FFT when
 * the frame is pulled; magnitudes `√(re · re + im · im)` and phases
 * `arctangentTurns(im, re)` (ADR-0032).
 */

import { ReferenceFft } from '../fft.js';
import { arctangentTurns, cosineOfTurns } from '../trigonometry.js';
import { ReferenceFraming } from './framing.js';

/** A short-time Fourier transform, its settings already checked. */
export class ReferenceStft {
  readonly size: number;
  readonly hop: number;
  readonly bins: number;
  readonly #framing: ReferenceFraming;
  readonly #fft: ReferenceFft;
  readonly #window: Float64Array;
  readonly #signal: Float64Array;
  readonly #real: Float64Array;
  readonly #imaginary: Float64Array;

  constructor(channels: number, size: number, hop: number) {
    this.size = size;
    this.hop = hop;
    this.#framing = new ReferenceFraming(channels, size, hop);
    this.#fft = new ReferenceFft(size);
    this.bins = this.#fft.bins;
    this.#window = new Float64Array(size);
    for (let n = 0; n < size; n += 1) this.#window[n] = 0.5 - 0.5 * cosineOfTurns(n / size);
    this.#signal = new Float64Array(size);
    this.#real = new Float64Array(this.bins);
    this.#imaginary = new Float64Array(this.bins);
  }

  get channels(): number {
    return this.#framing.channels;
  }

  /** Appends one chunk of `frames` samples a channel, its shape checked by the port. */
  push(input: readonly Float32Array[], frames: number): void {
    this.#framing.push(input, frames);
  }

  /** Writes the next frame's spectra, channel `c` from `c · bins`, if one is ready; `pull_complex`. */
  pullComplex(real: Float64Array, imaginary: Float64Array): boolean {
    const framing = this.#framing;
    if (!framing.ready) return false;
    const offset = framing.offset;
    for (let channel = 0; channel < framing.channels; channel += 1) {
      const samples = framing.samples(channel);
      for (let n = 0; n < this.size; n += 1) {
        this.#signal[n] = (samples[offset + n] ?? 0) * (this.#window[n] ?? 0);
      }
      this.#fft.forwardReal(this.#signal, this.#real, this.#imaginary);
      real.set(this.#real, channel * this.bins);
      imaginary.set(this.#imaginary, channel * this.bins);
    }
    framing.advance();
    return true;
  }

  /** As {@link pullComplex}, as magnitudes and phases in turns; `pull_polar`. */
  pullPolar(magnitudes: Float64Array, phases: Float64Array): boolean {
    if (!this.pullComplex(magnitudes, phases)) return false;
    toPolar(magnitudes, phases);
    return true;
  }
}

/**
 * Replaces each bin's real and imaginary parts with its magnitude and its
 * phase in turns. A loop of its own, so the optimiser can inline the
 * arctangent into it: left out of line, each angle it answered would be an
 * allocation.
 */
function toPolar(magnitudes: Float64Array, phases: Float64Array): void {
  for (let index = 0; index < magnitudes.length; index += 1) {
    const re = magnitudes[index] ?? 0;
    const im = phases[index] ?? 0;
    magnitudes[index] = Math.sqrt(re * re + im * im);
    phases[index] = arctangentTurns(im, re);
  }
}
