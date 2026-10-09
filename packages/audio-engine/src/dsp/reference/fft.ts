/**
 * The FFT of real signals, as `fft.rs` computes it, operation for operation:
 * the real signal of `N` samples taken as a complex signal of `N/2`,
 * transformed by an iterative radix-2 decimation in time over bit-reversed
 * order, and the real spectrum separated from it, unscaled; the inverse
 * scaled by `1/N` (ADR-0032).
 *
 * The twiddle factors are `cosineOfTurns(k/N)` and `cosineOfTurns(1/4 − k/N)`
 * for `k` from 0 to `N/2`, made with the scratch when the transform is, so a
 * transform allocates nothing.
 */

import { cosineOfTurns } from './trigonometry.js';

/** A transform of real signals of one size, its size already checked by `checkFftSize`. */
export class ReferenceFft {
  /** `N`, the samples of a signal. */
  readonly size: number;
  /** `N/2 + 1`, the bins of a spectrum. */
  readonly bins: number;
  readonly #half: number;
  readonly #cosines: Float64Array;
  readonly #sines: Float64Array;
  readonly #reversed: Uint32Array;
  readonly #real: Float64Array;
  readonly #imaginary: Float64Array;

  constructor(size: number) {
    const half = size / 2;
    this.size = size;
    this.bins = half + 1;
    this.#half = half;
    this.#cosines = new Float64Array(half + 1);
    this.#sines = new Float64Array(half + 1);
    for (let k = 0; k <= half; k += 1) {
      this.#cosines[k] = cosineOfTurns(k / size);
      this.#sines[k] = cosineOfTurns(0.25 - k / size);
    }
    let bits = 0;
    while (2 ** bits < half) bits += 1;
    this.#reversed = new Uint32Array(half);
    for (let index = 0; index < half; index += 1) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit += 1) reversed = (reversed << 1) | ((index >>> bit) & 1);
      this.#reversed[index] = reversed;
    }
    this.#real = new Float64Array(half);
    this.#imaginary = new Float64Array(half);
  }

  /** The spectrum of `signal`, whose lengths the port has checked; `forward_real` in `fft.rs`. */
  forwardReal(
    signal: Float32Array | Float64Array,
    real: Float64Array,
    imaginary: Float64Array,
  ): void {
    const half = this.#half;
    const re = this.#real;
    const im = this.#imaginary;
    for (let index = 0; index < half; index += 1) {
      const at = this.#reversed[index] ?? 0;
      re[at] = signal[2 * index] ?? 0;
      im[at] = signal[2 * index + 1] ?? 0;
    }
    this.#butterflies(-1);
    for (let k = 0; k <= half; k += 1) {
      const here = k % half;
      const there = (half - k) % half;
      const zr = re[here] ?? 0;
      const zi = im[here] ?? 0;
      const cr = re[there] ?? 0;
      const ci = im[there] ?? 0;
      const evenReal = (zr + cr) * 0.5;
      const evenImaginary = (zi - ci) * 0.5;
      const oddReal = (zi + ci) * 0.5;
      const oddImaginary = (cr - zr) * 0.5;
      const cosine = this.#cosines[k] ?? 0;
      const sine = this.#sines[k] ?? 0;
      real[k] = evenReal + (cosine * oddReal + sine * oddImaginary);
      imaginary[k] = evenImaginary + (cosine * oddImaginary - sine * oddReal);
    }
  }

  /** The signal whose spectrum is `real` and `imaginary`; `inverse_real` in `fft.rs`. */
  inverseReal(
    real: Float64Array,
    imaginary: Float64Array,
    signal: Float32Array | Float64Array,
  ): void {
    const half = this.#half;
    const re = this.#real;
    const im = this.#imaginary;
    for (let k = 0; k < half; k += 1) {
      const xr = real[k] ?? 0;
      const xi = k === 0 ? 0 : (imaginary[k] ?? 0);
      const yr = real[half - k] ?? 0;
      const yi = k === 0 ? 0 : -(imaginary[half - k] ?? 0);
      const er = xr + yr;
      const ei = xi + yi;
      const dr = xr - yr;
      const di = xi - yi;
      const cosine = this.#cosines[k] ?? 0;
      const sine = this.#sines[k] ?? 0;
      const oddReal = dr * cosine - di * sine;
      const oddImaginary = dr * sine + di * cosine;
      const at = this.#reversed[k] ?? 0;
      re[at] = er - oddImaginary;
      im[at] = ei + oddReal;
    }
    this.#butterflies(1);
    const scale = 1 / this.size;
    for (let index = 0; index < half; index += 1) {
      // Storing into a Float32Array rounds once, as the module's f64 copied into one does.
      signal[2 * index] = (re[index] ?? 0) * scale;
      signal[2 * index + 1] = (im[index] ?? 0) * scale;
    }
  }

  /** The complex transform in place, `direction` −1 forward and +1 inverse; `butterflies` in `fft.rs`. */
  #butterflies(direction: number): void {
    const half = this.#half;
    const re = this.#real;
    const im = this.#imaginary;
    for (let span = 2; span <= half; span *= 2) {
      const stride = this.size / span;
      const offset = span / 2;
      for (let start = 0; start < half; start += span) {
        for (let j = 0; j < offset; j += 1) {
          const cosine = this.#cosines[j * stride] ?? 0;
          const sine = direction * (this.#sines[j * stride] ?? 0);
          const a = start + j;
          const b = a + offset;
          const br = re[b] ?? 0;
          const bi = im[b] ?? 0;
          const tr = cosine * br - sine * bi;
          const ti = cosine * bi + sine * br;
          const ar = re[a] ?? 0;
          const ai = im[a] ?? 0;
          re[b] = ar - tr;
          im[b] = ai - ti;
          re[a] = ar + tr;
          im[a] = ai + ti;
        }
      }
    }
  }
}
