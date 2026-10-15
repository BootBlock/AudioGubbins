/**
 * The normalised cross-correlation of a start's neighbourhood with every end
 * a search may take (the plan's candidate search, step 4): the multichannel
 * `Σ_c Σ_n a_c · b_c ÷ √(Σ_c Σ a² · Σ_c Σ b²)`, its numerator by the
 * canonical FFT in overlap-save blocks of at most 65,536 frames, the largest
 * canonical size, in ascending order, and its energies by prefix sums of
 * squares. Audio outside the region reads as zero, so it is left out of every
 * sum.
 */

import { LARGEST_FFT_SIZE, type CanonicalFft } from '@audiogubbins/audio-engine';

import type { LoopCapture } from './loop-capture.js';
import type { MeasuringKit } from './measuring-kit.js';
import { LEAST_DEVIATION } from './seam-residual.js';

/** Frames `[from, to)` of `channel`, zero outside the region. */
export function framesOf(
  capture: LoopCapture,
  channel: number,
  from: number,
  to: number,
): Float64Array {
  const frames = new Float64Array(to - from);
  const lo = Math.max(0, from);
  const hi = Math.min(capture.regionLength, to);
  if (hi > lo) frames.set(capture.samples(channel, lo, hi), lo - from);
  return frames;
}

/** Sums of `values` before each index, from 0 to `values.length`. */
export function prefixSums(values: Float64Array): Float64Array {
  const sums = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index += 1) {
    sums[index + 1] = (sums[index] ?? 0) + (values[index] ?? 0);
  }
  return sums;
}

/** The squares of `channels`, frame by frame, summed over the channels. */
export function squaresOver(channels: readonly Float64Array[], frames: number): Float64Array {
  const squares = new Float64Array(frames);
  for (const samples of channels) {
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = samples[frame] ?? 0;
      squares[frame] = (squares[frame] ?? 0) + sample * sample;
    }
  }
  return squares;
}

/** The correlation of a numerator over two energies, 0 where both are under the floor. */
export function normalised(numerator: number, first: number, second: number): number {
  return numerator / Math.max(Math.sqrt(first * second), LEAST_DEVIATION);
}

/** The smallest power of two of at least `frames`, within the canonical sizes. */
function transformSize(frames: number): number {
  let size = 64;
  while (size < frames && size < LARGEST_FFT_SIZE) size *= 2;
  return size;
}

/**
 * The normalised cross-correlation of a start's neighbourhood with every end
 * of the end window, by the canonical FFT in overlap-save blocks of at most
 * 65,536 frames, the end window's spectra made once for every start.
 */
export class EndCorrelator {
  /** The first end scored; score `m` is of end `firstEnd + m`. */
  readonly firstEnd: number;
  /** How many ends are scored. */
  readonly ends: number;
  readonly #capture: LoopCapture;
  readonly #fft: CanonicalFft;
  readonly #half: number;
  readonly #hop: number;
  readonly #energies: Float64Array;
  readonly #templates: readonly { readonly real: Float64Array; readonly imaginary: Float64Array }[];
  readonly #spectra: readonly (readonly {
    readonly real: Float64Array;
    readonly imaginary: Float64Array;
    readonly template: { readonly real: Float64Array; readonly imaginary: Float64Array };
  }[])[];
  readonly #padded: Float64Array;
  readonly #productReal: Float64Array;
  readonly #productImaginary: Float64Array;
  readonly #correlation: Float64Array;

  /**
   * Scores the ends `[firstEnd, lastEnd]` of `capture` against starts'
   * neighbourhoods of `half` frames either side.
   */
  constructor(
    capture: LoopCapture,
    kit: MeasuringKit,
    firstEnd: number,
    lastEnd: number,
    half: number,
  ) {
    this.firstEnd = firstEnd;
    this.ends = Math.max(0, lastEnd - firstEnd + 1);
    this.#capture = capture;
    this.#half = half;
    const span = 2 * half;
    const signalFrom = firstEnd - half;
    const signalLength = this.ends + span - 1;
    const signal = Array.from({ length: capture.channels }, (_, channel) =>
      framesOf(capture, channel, signalFrom, signalFrom + signalLength),
    );
    this.#energies = prefixSums(squaresOver(signal, signalLength));
    const size = transformSize(signalLength);
    this.#hop = size - (span - 1);
    this.#fft = kit.fft(size);
    const bins = this.#fft.bins;
    const fft = this.#fft;
    const hop = this.#hop;
    // Each channel's template spectrum, remade for each start, and the end
    // window's spectra a block at a time, made once.
    const channels = signal.map((samples) => ({
      samples,
      template: { real: new Float64Array(bins), imaginary: new Float64Array(bins) },
    }));
    this.#templates = channels.map(({ template }) => template);
    this.#spectra = Array.from({ length: Math.ceil(this.ends / hop) }, (_, block) =>
      channels.map(({ samples, template }) => {
        const segment = new Float64Array(size);
        segment.set(samples.subarray(block * hop, Math.min(samples.length, block * hop + size)));
        const real = new Float64Array(bins);
        const imaginary = new Float64Array(bins);
        fft.forwardReal(segment, real, imaginary);
        return { real, imaginary, template };
      }),
    );
    this.#padded = new Float64Array(size);
    this.#productReal = new Float64Array(bins);
    this.#productImaginary = new Float64Array(bins);
    this.#correlation = new Float64Array(size);
  }

  /** Writes the correlation of `start`'s neighbourhood with each end into `scores`, `ends` long. */
  scores(start: number, scores: Float64Array): void {
    const half = this.#half;
    const span = 2 * half;
    const fft = this.#fft;
    let templateEnergy = 0;
    this.#templates.forEach((template, channel) => {
      const samples = framesOf(this.#capture, channel, start - half, start + half);
      for (const sample of samples) templateEnergy += sample * sample;
      this.#padded.fill(0);
      this.#padded.set(samples);
      fft.forwardReal(this.#padded, template.real, template.imaginary);
    });
    const productReal = this.#productReal;
    const productImaginary = this.#productImaginary;
    for (const [block, perChannel] of this.#spectra.entries()) {
      productReal.fill(0);
      productImaginary.fill(0);
      for (const { real, imaginary, template } of perChannel) {
        for (let bin = 0; bin < fft.bins; bin += 1) {
          const xr = real[bin] ?? 0;
          const xi = imaginary[bin] ?? 0;
          const cr = template.real[bin] ?? 0;
          const ci = template.imaginary[bin] ?? 0;
          // The signal's spectrum times the template's conjugate: a correlation, not a convolution.
          productReal[bin] = (productReal[bin] ?? 0) + (xr * cr + xi * ci);
          productImaginary[bin] = (productImaginary[bin] ?? 0) + (xi * cr - xr * ci);
        }
      }
      fft.inverseReal(productReal, productImaginary, this.#correlation);
      for (let lag = 0; lag < this.#hop; lag += 1) {
        const output = block * this.#hop + lag;
        if (output >= this.ends) break;
        const energy = (this.#energies[output + span] ?? 0) - (this.#energies[output] ?? 0);
        scores[output] = normalised(this.#correlation[lag] ?? 0, templateEnergy, energy);
      }
    }
  }
}
