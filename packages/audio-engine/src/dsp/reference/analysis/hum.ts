/**
 * Hum features, as `hum.rs` extracts them: per STFT frame, channel and hum
 * frequency (50, 100, 60 and 120 Hz), the peak bin within the search width,
 * its frequency and level interpolated by the parabola through the levels
 * of it and its neighbours, and the median level of the bins within the
 * floor width less the five about the peak (ADR-0032).
 */

import { gainToDecibels } from '../decibels.js';
import type { FeatureExtractor } from './feature-extractor.js';
import { rankAt, selectRank } from './selection.js';
import { ReferenceStft } from './stft.js';

/** The frequencies a hum is sought at: `HUM_FREQUENCIES` in `hum.rs`. */
const HUM_FREQUENCIES: readonly number[] = [50, 100, 60, 120];

/** Each hum frequency's search and floor bins: low and high of each, in that order. */
type Bands = readonly [number, number, number, number];

/** A frame's spectra, and one channel's magnitudes and levels computed from them. */
interface Spectrum {
  readonly real: Float64Array;
  readonly imaginary: Float64Array;
  readonly size: number;
  readonly magnitudes: Float64Array;
  readonly levels: Float64Array;
}

/**
 * Writes the magnitude `√(re · re + im · im)` and level
 * `gainToDecibels((4 · magnitude) / N)` of bins `first` to `last` of the
 * channel whose spectrum starts at `base`, as `Spectrum` in `hum.rs`
 * computes them. A loop of its own, so the optimiser can inline the
 * logarithm into it: left out of line, each level it answered would be an
 * allocation.
 */
function levelsOf(spectrum: Spectrum, base: number, first: number, last: number): void {
  for (let bin = first; bin <= last; bin += 1) {
    const re = spectrum.real[base + bin] ?? 0;
    const im = spectrum.imaginary[base + bin] ?? 0;
    const magnitude = Math.sqrt(re * re + im * im);
    spectrum.magnitudes[bin] = magnitude;
    spectrum.levels[bin] = gainToDecibels((4 * magnitude) / spectrum.size);
  }
}

/** Each channel's hum peaks and floors, the settings already checked. */
export class ReferenceHum implements FeatureExtractor {
  readonly recordWidth: number;
  readonly #stft: ReferenceStft;
  readonly #rate: number;
  readonly #bands: readonly Bands[];
  /** The first and last bin any frequency's search or floor reads, a neighbour included. */
  readonly #first: number;
  readonly #last: number;
  readonly #real: Float64Array;
  readonly #imaginary: Float64Array;
  /** One channel's magnitudes and levels over the bins read, computed before any is read. */
  readonly #magnitudes: Float64Array;
  readonly #levels: Float64Array;
  readonly #spectrum: Spectrum;
  readonly #scratch: Float64Array;

  constructor(
    channels: number,
    sampleRate: number,
    stft: { readonly size: number; readonly hop: number },
    widths: { readonly search: number; readonly floor: number },
  ) {
    this.recordWidth = channels * 3 * HUM_FREQUENCIES.length;
    this.#stft = new ReferenceStft(channels, stft.size, stft.hop);
    this.#rate = sampleRate;
    const last = stft.size / 2;
    const bin = (hertz: number, round: (value: number) => number, low: number, high: number) =>
      Math.min(
        Math.max(Math.min(Math.max(round((hertz * stft.size) / sampleRate), 0), high), low),
        high,
      );
    this.#bands = HUM_FREQUENCIES.map((frequency) => [
      bin(frequency - widths.search, Math.floor, 1, last - 1),
      bin(frequency + widths.search, Math.ceil, 1, last - 1),
      bin(frequency - widths.floor, Math.floor, 1, last),
      bin(frequency + widths.floor, Math.ceil, 1, last),
    ]);
    this.#first = Math.min(...this.#bands.map(([low, , from]) => Math.min(low - 1, from)));
    this.#last = Math.max(...this.#bands.map(([, high, , to]) => Math.max(high + 1, to)));
    const bins = this.#stft.bins;
    this.#real = new Float64Array(channels * bins);
    this.#imaginary = new Float64Array(channels * bins);
    this.#magnitudes = new Float64Array(bins);
    this.#levels = new Float64Array(bins);
    this.#spectrum = {
      real: this.#real,
      imaginary: this.#imaginary,
      size: stft.size,
      magnitudes: this.#magnitudes,
      levels: this.#levels,
    };
    this.#scratch = new Float64Array(bins);
  }

  push(input: readonly Float32Array[], frames: number): void {
    this.#stft.push(input, frames);
  }

  pull(into: Float64Array): number {
    const capacity = Math.floor(into.length / this.recordWidth);
    const bins = this.#stft.bins;
    let written = 0;
    while (written < capacity && this.#stft.pullComplex(this.#real, this.#imaginary)) {
      for (let channel = 0; channel < this.#stft.channels; channel += 1) {
        levelsOf(this.#spectrum, channel * bins, this.#first, this.#last);
        for (let target = 0; target < this.#bands.length; target += 1) {
          const bands = this.#bands[target];
          if (bands === undefined) continue;
          const at = written * this.recordWidth + (channel * this.#bands.length + target) * 3;
          this.#humAt(bands, into, at);
        }
      }
      written += 1;
    }
    return written;
  }

  /** Writes `[frequency, level, floor]` for one channel's frame and one frequency, from `at`; `hum_at`. */
  #humAt(bands: Bands, into: Float64Array, at: number): void {
    const [low, high, from, to] = bands;
    const magnitudes = this.#magnitudes;
    const levels = this.#levels;
    let peak = low;
    let largest = magnitudes[low] ?? 0;
    for (let bin = low + 1; bin <= high; bin += 1) {
      const magnitude = magnitudes[bin] ?? 0;
      if (magnitude > largest) {
        largest = magnitude;
        peak = bin;
      }
    }
    const alpha = levels[peak - 1] ?? 0;
    const beta = levels[peak] ?? 0;
    const gamma = levels[peak + 1] ?? 0;
    const curvature = alpha - 2 * beta + gamma;
    const finite = Number.isFinite(alpha) && Number.isFinite(beta) && Number.isFinite(gamma);
    const offset =
      finite && curvature < 0
        ? Math.min(Math.max((0.5 * (alpha - gamma)) / curvature, -0.5), 0.5)
        : 0;
    into[at] = ((peak + offset) * this.#rate) / this.#stft.size;
    into[at + 1] = beta - 0.25 * (alpha - gamma) * offset;
    let count = 0;
    for (let bin = from; bin <= to; bin += 1) {
      if (bin + 2 < peak || bin > peak + 2) {
        this.#scratch[count] = levels[bin] ?? 0;
        count += 1;
      }
    }
    if (count === 0) {
      into[at + 2] = Number.NEGATIVE_INFINITY;
      return;
    }
    const rank = rankAt(count, 0.5);
    selectRank(this.#scratch, count, rank);
    into[at + 2] = this.#scratch[rank] ?? 0;
  }
}
