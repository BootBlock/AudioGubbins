/**
 * The discrete Fourier transform of real signals of an even length that need
 * not be a power of two, such as DeepFilterNet's 960 samples, on the
 * canonical FFT, which takes powers of two alone (ADR-0032, ADR-0061).
 *
 * Bluestein's algorithm writes a transform of length `N` as a convolution
 * with a chirp, `e^(−iπn²/N)`, which is taken by FFTs of the power of two `M`
 * at or above `2N − 1`. The complex FFTs it needs are each two of the
 * canonical real FFTs, of the real parts and of the imaginary parts, joined
 * by the symmetry of a real signal's spectrum. Every value is a double and
 * every step a basic operation in a stated order, the chirp from the
 * canonical sine and cosine of an exact number of turns (`n² mod 2N` over
 * `2N`), so a transform is the same bits on every machine. Both directions
 * are unscaled, as libDF's real FFT is: the inverse of the forward transform
 * is the signal times `N`.
 */

import {
  cosineOfTurns,
  sineOfTurns,
  type CanonicalDsp,
  type CanonicalFft,
} from '@audiogubbins/audio-engine';

/** The smallest power of two at or above `length`. */
function powerOfTwoAtLeast(length: number): number {
  let size = 1;
  while (size < length) size *= 2;
  return size;
}

export class RealDft {
  /** `N`, the samples of a signal. */
  readonly size: number;
  /** `N/2 + 1`, the bins of a spectrum. */
  readonly bins: number;
  readonly #fft: CanonicalFft;
  readonly #chirpReal: Float64Array;
  readonly #chirpImaginary: Float64Array;
  /** The FFT of the conjugate chirp, wrapped about zero, which every transform convolves with. */
  readonly #kernelReal: Float64Array;
  readonly #kernelImaginary: Float64Array;
  readonly #real: Float64Array;
  readonly #imaginary: Float64Array;
  readonly #halfReal: Float64Array;
  readonly #halfImaginary: Float64Array;
  readonly #otherReal: Float64Array;
  readonly #otherImaginary: Float64Array;
  readonly #partReal: Float64Array;
  readonly #partImaginary: Float64Array;

  private constructor(size: number, fft: CanonicalFft) {
    this.size = size;
    this.bins = size / 2 + 1;
    this.#fft = fft;
    const length = fft.size;
    this.#chirpReal = new Float64Array(size);
    this.#chirpImaginary = new Float64Array(size);
    for (let n = 0; n < size; n += 1) {
      // The chirp's angle, π·n²/N, in turns: n² is exact, and its remainder
      // over 2N keeps the turns below one, where the primitives are exact.
      const turns = ((n * n) % (2 * size)) / (2 * size);
      this.#chirpReal[n] = cosineOfTurns(turns);
      this.#chirpImaginary[n] = -sineOfTurns(turns);
    }
    this.#real = new Float64Array(length);
    this.#imaginary = new Float64Array(length);
    this.#halfReal = new Float64Array(fft.bins);
    this.#halfImaginary = new Float64Array(fft.bins);
    this.#otherReal = new Float64Array(fft.bins);
    this.#otherImaginary = new Float64Array(fft.bins);
    this.#partReal = new Float64Array(length);
    this.#partImaginary = new Float64Array(length);
    this.#kernelReal = new Float64Array(length);
    this.#kernelImaginary = new Float64Array(length);
    for (let n = 0; n < size; n += 1) {
      const real = this.#chirpReal[n] ?? 0;
      const imaginary = -(this.#chirpImaginary[n] ?? 0);
      this.#kernelReal[n] = real;
      this.#kernelImaginary[n] = imaginary;
      if (n > 0) {
        this.#kernelReal[length - n] = real;
        this.#kernelImaginary[length - n] = imaginary;
      }
    }
    this.#complexFft(this.#kernelReal, this.#kernelImaginary);
  }

  /** A transform of `size` samples, an even number, on `dsp`'s FFT; throws where the FFT cannot be made. */
  static of(dsp: CanonicalDsp, size: number): RealDft {
    const fft = dsp.createFft(powerOfTwoAtLeast(2 * size - 1));
    // The size is a constant of the processor that asks, and every power of
    // two the FFT takes reaches it, so a refusal is a fault there.
    if (!fft.ok) throw new Error(`No FFT serves a transform of ${String(size)}.`);
    return new RealDft(size, fft.value);
  }

  /**
   * Writes the spectrum of `signal`, `N` samples, to `real` and `imaginary`,
   * `N/2 + 1` bins each: bin `k` is `Σ signal[n] · e^(−2πikn/N)`.
   */
  forward(signal: Float64Array, real: Float64Array, imaginary: Float64Array): void {
    const { size } = this;
    this.#real.fill(0);
    this.#imaginary.fill(0);
    for (let n = 0; n < size; n += 1) {
      const sample = signal[n] ?? 0;
      this.#real[n] = sample * (this.#chirpReal[n] ?? 0);
      this.#imaginary[n] = sample * (this.#chirpImaginary[n] ?? 0);
    }
    this.#convolve();
    for (let k = 0; k < this.bins; k += 1) {
      const a = this.#real[k] ?? 0;
      const b = this.#imaginary[k] ?? 0;
      const c = this.#chirpReal[k] ?? 0;
      const d = this.#chirpImaginary[k] ?? 0;
      real[k] = a * c - b * d;
      imaginary[k] = a * d + b * c;
    }
  }

  /**
   * Writes the `N` samples whose spectrum is `real` and `imaginary` to
   * `signal`, unscaled: sample `n` is `Σ X[k] · e^(2πikn/N)` over the whole
   * spectrum, its upper half the conjugate of the lower. The imaginary parts
   * of bins 0 and `N/2` are taken as zero, as a real signal's are.
   */
  inverse(real: Float64Array, imaginary: Float64Array, signal: Float64Array): void {
    const { size } = this;
    const half = size / 2;
    this.#real.fill(0);
    this.#imaginary.fill(0);
    for (let n = 0; n < size; n += 1) {
      // The conjugate of the whole spectrum at `n`, its transform's real part
      // being the sum asked for.
      const mirrored = n > half;
      const bin = mirrored ? size - n : n;
      const a = real[bin] ?? 0;
      const b =
        bin === 0 || bin === half ? 0 : mirrored ? (imaginary[bin] ?? 0) : -(imaginary[bin] ?? 0);
      const c = this.#chirpReal[n] ?? 0;
      const d = this.#chirpImaginary[n] ?? 0;
      this.#real[n] = a * c - b * d;
      this.#imaginary[n] = a * d + b * c;
    }
    this.#convolve();
    for (let n = 0; n < size; n += 1) {
      signal[n] =
        (this.#real[n] ?? 0) * (this.#chirpReal[n] ?? 0) -
        (this.#imaginary[n] ?? 0) * (this.#chirpImaginary[n] ?? 0);
    }
  }

  release(): void {
    this.#fft.release();
  }

  /** Convolves the working arrays, circularly over `M`, with the conjugate chirp. */
  #convolve(): void {
    const length = this.#fft.size;
    this.#complexFft(this.#real, this.#imaginary);
    for (let k = 0; k < length; k += 1) {
      const a = this.#real[k] ?? 0;
      const b = this.#imaginary[k] ?? 0;
      const c = this.#kernelReal[k] ?? 0;
      const d = this.#kernelImaginary[k] ?? 0;
      // The product, conjugated, so the forward FFT below is the inverse.
      this.#real[k] = a * c - b * d;
      this.#imaginary[k] = -(a * d + b * c);
    }
    this.#complexFft(this.#real, this.#imaginary);
    const scale = 1 / length;
    for (let n = 0; n < length; n += 1) {
      this.#real[n] = (this.#real[n] ?? 0) * scale;
      this.#imaginary[n] = -(this.#imaginary[n] ?? 0) * scale;
    }
  }

  /** The complex FFT of `real` + i·`imaginary`, in place, by two real FFTs. */
  #complexFft(real: Float64Array, imaginary: Float64Array): void {
    const length = this.#fft.size;
    const half = length / 2;
    this.#partReal.set(real);
    this.#partImaginary.set(imaginary);
    this.#fft.forwardReal(this.#partReal, this.#halfReal, this.#halfImaginary);
    this.#fft.forwardReal(this.#partImaginary, this.#otherReal, this.#otherImaginary);
    for (let k = 0; k < length; k += 1) {
      const mirrored = k > half;
      const bin = mirrored ? length - k : k;
      const sign = mirrored ? -1 : 1;
      const ar = this.#halfReal[bin] ?? 0;
      const ai = sign * (this.#halfImaginary[bin] ?? 0);
      const br = this.#otherReal[bin] ?? 0;
      const bi = sign * (this.#otherImaginary[bin] ?? 0);
      real[k] = ar - bi;
      imaginary[k] = ai + br;
    }
  }
}
