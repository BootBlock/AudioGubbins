/**
 * The phase-locked pitch shift of Laroche and Dolson (IEEE WASPAA, 1999),
 * applied to one frame of every channel at once.
 *
 * The frame's peaks are found on the sum of the channels' magnitudes, by the
 * engine's peak picking (`findPeaks`), and each governs the region of bins
 * nearer it than any other (`regionEnd`). For each peak:
 *
 * - Its frequency `f` (turns a sample) is `(p + δ)/N`, `p` the peak's bin and
 *   `δ` how far the partial lies towards the louder of the bins either side,
 *   from the summed magnitudes: under the vocoder's window, `sin(πn/N)`, a
 *   partial `δ` bins from a bin is heard in it as `cos(πδ)/(1 − 4δ²)`, so the
 *   louder neighbour is `ρ = (1 + 2δ)/(3 − 2δ)` times the peak and
 *   `δ = (3ρ − 1)/(2(1 + ρ))`, held to `[0, 1/2]`, and negated for the
 *   neighbour below. A measure of the magnitudes alone needs no phase from the
 *   frame before, and every channel's share of a source has the same shape, so
 *   their sum is measured as one.
 * - Its region is rotated by `θ = θ′ + H · (r·f − f)` turns, `r` the ratio and
 *   `θ′` the rotation the previous frame gave the region its peak's bin lay in,
 *   so the shifted partial's phase advances by `H · r·f` a hop, as a partial at
 *   `r·f` does.
 * - Its region is moved by `Δ = N · (r·f − f)` bins: bin `k` goes to `k + Δ`,
 *   split between the bins either side by linear interpolation, `1 − φ` of it
 *   to `k + m` and `φ` to `k + m + 1`, where `m = ⌊Δ⌋` and `φ = Δ − m`, both
 *   shares divided by `G(φ)`. A frame is windowed from its first sample, so a
 *   partial's bins alternate in sign about its centre; a move by `m` bins
 *   therefore multiplies by `(−1)^m`, which keeps the moved bins those of a
 *   partial centred on the frame as the unmoved ones were. Bins moved past
 *   either end are dropped.
 * - The split is, in time, the frame times `(1 − φ) + φ · e^(2πiτ/N)` where an
 *   exact move would multiply by `e^(2πiφτ/N)`, `τ` the samples from the
 *   frame's centre: a taper towards the frame's edges, whose mean under the two
 *   windows, the Hann window, is
 *   `G(φ) = sin(πφ)/π · (1/(φ(1 + φ)) + 1/((1 − φ)(2 − φ)))`, 0.85 at its
 *   least, at `φ = 1/2`. Dividing by it keeps a partial's level; what is left
 *   is a ripple at the hop, under 0.1 dB at an overlap of four.
 *
 * Every channel takes the same regions, moves and rotations, so the shift is
 * one linear map of each channel's spectrum: a level or phase difference
 * between channels, a stereo image or an ambisonic set's directions, is kept.
 * A frame with no peak, silence or a lone click, has no partial to move, and
 * is passed on unchanged with no rotation. At a ratio of one, `Δ` and the
 * rotation are zero, so each frame is its own spectrum and the stream comes
 * back to the rounding of the transforms.
 */

import { cosineOfTurns, findPeaks, regionEnd, sineOfTurns } from '@audiogubbins/audio-engine';

/** Slots of {@link PeakShift.#parts}, each a double carried between a method and its caller. */
const FREQUENCY = 0;
const ROTATION = 1;
const OFFSET = 2;
const WHOLE = 3;
const LOWER = 4;
const UPPER = 5;

/** One frame of every channel, analysed, shifted in pitch, and ready to be heard again. */
export class PeakShift {
  readonly #size: number;
  readonly #bins: number;
  readonly #hop: number;
  /** Each channel's spectrum of the frame, which the kernel's FFT writes. */
  readonly real: readonly Float64Array[];
  readonly imaginary: readonly Float64Array[];
  /** Each channel's shifted spectrum, which the kernel's inverse FFT reads. */
  readonly shiftedReal: readonly Float64Array[];
  readonly shiftedImaginary: readonly Float64Array[];
  /** The ratio of the frequencies, which the kernel writes before each frame. */
  readonly ratio = new Float64Array(1);
  readonly #magnitude: Float64Array;
  readonly #peaks: Int32Array;
  /** The rotation, in turns, of the region each bin lay in, this frame and the last. */
  #rotation: Float64Array;
  #rotationBefore: Float64Array;
  /**
   * Where a method leaves a double for the one that called it: V8 boxes a
   * double returned from a call it does not inline, a heap number a peak on
   * the audio thread, so the doubles cross calls only through here.
   */
  readonly #parts = new Float64Array(6);

  /** The shift of frames of `size` samples, `hop` apart, on `channels` channels. */
  constructor(size: number, hop: number, channels: number) {
    const bins = size / 2 + 1;
    const spectra = () => Array.from({ length: channels }, () => new Float64Array(bins));
    this.#size = size;
    this.#bins = bins;
    this.#hop = hop;
    this.real = spectra();
    this.imaginary = spectra();
    this.shiftedReal = spectra();
    this.shiftedImaginary = spectra();
    this.#magnitude = new Float64Array(bins);
    this.#peaks = new Int32Array(bins);
    this.#rotation = new Float64Array(bins);
    this.#rotationBefore = new Float64Array(bins);
  }

  /** Shifts the frame the spectra hold into the shifted spectra, at the ratio. */
  shift(): void {
    const bins = this.#bins;
    for (let channel = 0; channel < this.real.length; channel += 1) {
      this.shiftedReal[channel]?.fill(0);
      this.shiftedImaginary[channel]?.fill(0);
    }
    this.#sumMagnitudes();
    const count = findPeaks(this.#magnitude, bins, this.#peaks);
    if (count === 0) {
      this.#parts[ROTATION] = 0;
      this.#parts[OFFSET] = 0;
      this.#move(0, bins);
    }
    let start = 0;
    for (let index = 0; index < count; index += 1) {
      const end = regionEnd(this.#peaks, index, count, bins);
      this.#measure(this.#peaks[index] ?? 0);
      this.#settle(this.#peaks[index] ?? 0);
      this.#move(start, end);
      start = end;
    }
    this.#remember();
  }

  /** Sums the channels' magnitudes, bin by bin, each channel in layout order. */
  #sumMagnitudes(): void {
    const magnitude = this.#magnitude;
    magnitude.fill(0);
    for (let channel = 0; channel < this.real.length; channel += 1) {
      const real = this.real[channel];
      const imaginary = this.imaginary[channel];
      if (real === undefined || imaginary === undefined) continue;
      for (let k = 0; k < this.#bins; k += 1) {
        const re = real[k] ?? 0;
        const im = imaginary[k] ?? 0;
        magnitude[k] = (magnitude[k] ?? 0) + Math.sqrt(re * re + im * im);
      }
    }
  }

  /** Leaves the frequency of the partial at bin `peak` in its slot. */
  #measure(peak: number): void {
    const magnitude = this.#magnitude;
    const level = magnitude[peak] ?? 0;
    const below = peak >= 1 ? (magnitude[peak - 1] ?? 0) : 0;
    const above = peak + 1 < this.#bins ? (magnitude[peak + 1] ?? 0) : 0;
    const upwards = above >= below;
    const ratio = level > 0 ? (upwards ? above : below) / level : 0;
    // `(3ρ − 1)/(2(1 + ρ))`, held to `[0, 1/2]`: a peak is at least as
    // loud as either neighbour, so `ρ` is at most one.
    const away = Math.min(0.5, Math.max(0, (3 * ratio - 1) / (2 * (1 + ratio))));
    this.#parts[FREQUENCY] = (peak + (upwards ? away : -away)) / this.#size;
  }

  /** Leaves the region's rotation and move, in turns and bins, in their slots. */
  #settle(peak: number): void {
    const frequency = this.#parts[FREQUENCY] ?? 0;
    // `r·f − f` once, so the rotation and the move take the same difference.
    const difference = (this.ratio[0] ?? 1) * frequency - frequency;
    const turns = (this.#rotationBefore[peak] ?? 0) + this.#hop * difference;
    this.#parts[ROTATION] = turns - Math.floor(turns);
    this.#parts[OFFSET] = this.#size * difference;
  }

  /** Rotates and moves bins `start` to `end` of every channel by the slots' rotation and move. */
  #move(start: number, end: number): void {
    const turns = this.#parts[ROTATION] ?? 0;
    // A loop, not `fill`: a double handed to a built-in is boxed.
    for (let k = start; k < end; k += 1) this.#rotation[k] = turns;
    const cosine = cosineOfTurns(turns);
    const sine = sineOfTurns(turns);
    this.#shares();
    // A whole number as an integer, so a bin it names is an integer index:
    // V8 boxes a double used as a typed array's index.
    const whole = (this.#parts[WHOLE] ?? 0) | 0;
    const lower = this.#parts[LOWER] ?? 0;
    const upper = this.#parts[UPPER] ?? 0;
    const bins = this.#bins;
    for (let channel = 0; channel < this.real.length; channel += 1) {
      const real = this.real[channel];
      const imaginary = this.imaginary[channel];
      const intoReal = this.shiftedReal[channel];
      const intoImaginary = this.shiftedImaginary[channel];
      if (
        real === undefined ||
        imaginary === undefined ||
        intoReal === undefined ||
        intoImaginary === undefined
      ) {
        continue;
      }
      for (let k = start; k < end; k += 1) {
        const re = real[k] ?? 0;
        const im = imaginary[k] ?? 0;
        const turnedRe = re * cosine - im * sine;
        const turnedIm = re * sine + im * cosine;
        const to = k + whole;
        if (to >= 0 && to < bins) {
          intoReal[to] = (intoReal[to] ?? 0) + lower * turnedRe;
          intoImaginary[to] = (intoImaginary[to] ?? 0) + lower * turnedIm;
        }
        if (upper !== 0 && to + 1 >= 0 && to + 1 < bins) {
          intoReal[to + 1] = (intoReal[to + 1] ?? 0) + upper * turnedRe;
          intoImaginary[to + 1] = (intoImaginary[to + 1] ?? 0) + upper * turnedIm;
        }
      }
    }
  }

  /**
   * Leaves the whole bins `m` of the slots' move and the shares of the bins
   * either side of where it lands, `(−1)^m (1 − φ)/G(φ)` and
   * `−(−1)^m φ/G(φ)`, in their slots. A move of whole bins is no split: its
   * shares are `(−1)^m` and none, so a ratio of one changes no bit.
   */
  #shares(): void {
    const offset = this.#parts[OFFSET] ?? 0;
    let whole = Math.floor(offset);
    let fraction = offset - whole;
    // A move a hair under a whole bin rounds `Δ − ⌊Δ⌋` up to one: it is the whole bin above.
    if (fraction >= 1) {
      whole += 1;
      fraction = 0;
    }
    const sign = whole % 2 === 0 ? 1 : -1;
    this.#parts[WHOLE] = whole;
    if (fraction === 0) {
      this.#parts[LOWER] = sign;
      this.#parts[UPPER] = 0;
      return;
    }
    // `sin(πφ)/π`, then each term of `G(φ)` in the order the comment above writes them.
    const sinePart = sineOfTurns(fraction / 2) / Math.PI;
    const gain =
      sinePart * (1 / (fraction * (1 + fraction)) + 1 / ((1 - fraction) * (2 - fraction)));
    this.#parts[LOWER] = (sign * (1 - fraction)) / gain;
    this.#parts[UPPER] = (-sign * fraction) / gain;
  }

  /** Keeps this frame's rotations as the next frame's previous ones. */
  #remember(): void {
    const rotation = this.#rotation;
    this.#rotation = this.#rotationBefore;
    this.#rotationBefore = rotation;
  }
}
