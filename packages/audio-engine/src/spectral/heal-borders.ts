/**
 * What a spectral heal puts in place of the magnitude under its mask
 * (ADR-0081): for each bin, a magnitude interpolated across time from the
 * frames bordering each run of frames the mask covers in that bin.
 *
 * The frames are given in order, once each. A run is the frames one after
 * another whose weight in the bin is above nothing. The border before a run is
 * the mean magnitude of up to four frames just before it that the mask leaves,
 * one after another, and the border after it likewise; where a run has both,
 * frame `k` of the run from `s` to `e` takes `before + t · (after − before)`,
 * `t = (k − s + 1) / (e − s + 2)`, so the heal joins its borders in a straight
 * line; where it has one, it takes that one; where it has none, its frames are
 * left as they are. Each mean is summed in the order of the frames, so every
 * machine finds the same.
 */

/** The most frames either border of a run is measured over. */
export const BORDER_FRAMES = 4;

/** One run of masked frames in a bin, and its borders per channel. */
interface Run {
  readonly start: number;
  end: number;
  /** The mean magnitude before it, per channel, or `undefined` where no frame was left before it. */
  readonly before: Float64Array | undefined;
  /** The sum of the magnitudes after it, per channel, and how many frames it holds. */
  readonly after: Float64Array;
  afterCount: number;
}

/** A frame's spectrum, one channel's. */
export interface Spectrum {
  readonly real: Float64Array;
  readonly imaginary: Float64Array;
}

/** The borders of every run of masked frames in every bin of a stream. */
export class HealBorders {
  readonly #bins: number;
  readonly #channels: number;
  /** Each bin's runs, in the order they began. */
  readonly #runs: Run[][];
  /** Each bin's run that is still open, if any. */
  readonly #open: (Run | undefined)[];
  /** Each bin's run whose after-border is still being measured, if any. */
  readonly #measuring: (Run | undefined)[];
  /**
   * The magnitudes of the frames just before, per bin and channel, oldest
   * first: `BORDER_FRAMES` slots of `channels` each.
   */
  readonly #recent: Float64Array;
  readonly #recentCount: Int32Array;
  readonly #magnitudes: Float64Array;

  constructor(bins: number, channels: number) {
    this.#bins = bins;
    this.#channels = channels;
    this.#runs = Array.from({ length: bins }, () => []);
    this.#open = Array.from({ length: bins }, () => undefined);
    this.#measuring = Array.from({ length: bins }, () => undefined);
    this.#recent = new Float64Array(bins * BORDER_FRAMES * channels);
    this.#recentCount = new Int32Array(bins);
    this.#magnitudes = new Float64Array(channels);
  }

  /**
   * Takes frame `k`, after every frame before it: its weights, `undefined`
   * where the mask covers none of it, and each channel's spectrum.
   */
  take(k: number, weights: Float64Array | undefined, spectra: readonly Spectrum[]): void {
    const channels = this.#channels;
    for (let bin = 0; bin < this.#bins; bin += 1) {
      if (weights !== undefined && (weights[bin] ?? 0) > 0) {
        this.#masked(bin, k);
        continue;
      }
      const magnitudes = this.#magnitudes;
      for (let channel = 0; channel < channels; channel += 1) {
        const spectrum = spectra[channel];
        const re = spectrum?.real[bin] ?? 0;
        const im = spectrum?.imaginary[bin] ?? 0;
        magnitudes[channel] = Math.sqrt(re * re + im * im);
      }
      this.#left(bin, magnitudes);
    }
  }

  /** Closes every run still open once the last frame has been taken. */
  finish(): void {
    this.#open.fill(undefined);
    this.#measuring.fill(undefined);
  }

  /**
   * The magnitude frame `k` takes in `bin` of `channel`, or `undefined`
   * where the frame lies in no run or its run has no border.
   */
  target(k: number, channel: number, bin: number): number | undefined {
    const run = this.#runAt(bin, k);
    if (run === undefined) return undefined;
    const before = run.before?.[channel];
    const after = run.afterCount > 0 ? (run.after[channel] ?? 0) / run.afterCount : undefined;
    if (before === undefined) return after;
    if (after === undefined) return before;
    const t = (k - run.start + 1) / (run.end - run.start + 2);
    return before + t * (after - before);
  }

  #masked(bin: number, k: number): void {
    const open = this.#open[bin];
    if (open !== undefined) {
      open.end = k;
      return;
    }
    this.#measuring[bin] = undefined;
    const count = this.#recentCount[bin] ?? 0;
    let before: Float64Array | undefined;
    if (count > 0) {
      before = new Float64Array(this.#channels);
      const base = bin * BORDER_FRAMES * this.#channels;
      for (let channel = 0; channel < this.#channels; channel += 1) {
        let sum = 0;
        for (let slot = 0; slot < count; slot += 1) {
          sum += this.#recent[base + slot * this.#channels + channel] ?? 0;
        }
        before[channel] = sum / count;
      }
    }
    const run: Run = {
      start: k,
      end: k,
      before,
      after: new Float64Array(this.#channels),
      afterCount: 0,
    };
    this.#runs[bin]?.push(run);
    this.#open[bin] = run;
    this.#recentCount[bin] = 0;
  }

  /** Records a frame the mask leaves in `bin`, with each channel's magnitude. */
  #left(bin: number, magnitudes: Float64Array): void {
    const channels = this.#channels;
    const open = this.#open[bin];
    if (open !== undefined) {
      this.#open[bin] = undefined;
      this.#measuring[bin] = open;
    }
    const measuring = this.#measuring[bin];
    if (measuring !== undefined) {
      for (let channel = 0; channel < channels; channel += 1) {
        measuring.after[channel] = (measuring.after[channel] ?? 0) + (magnitudes[channel] ?? 0);
      }
      measuring.afterCount += 1;
      if (measuring.afterCount === BORDER_FRAMES) this.#measuring[bin] = undefined;
    }
    const base = bin * BORDER_FRAMES * channels;
    const count = this.#recentCount[bin] ?? 0;
    if (count === BORDER_FRAMES) {
      this.#recent.copyWithin(base, base + channels, base + BORDER_FRAMES * channels);
    }
    const slot = Math.min(count, BORDER_FRAMES - 1);
    this.#recent.set(magnitudes, base + slot * channels);
    this.#recentCount[bin] = Math.min(count + 1, BORDER_FRAMES);
  }

  /** The run of `bin` that holds frame `k`, if any. */
  #runAt(bin: number, k: number): Run | undefined {
    const runs = this.#runs[bin];
    if (runs === undefined) return undefined;
    let low = 0;
    let high = runs.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((runs[middle]?.start ?? 0) <= k) low = middle + 1;
      else high = middle;
    }
    const run = runs[low - 1];
    return run !== undefined && k <= run.end ? run : undefined;
  }
}
