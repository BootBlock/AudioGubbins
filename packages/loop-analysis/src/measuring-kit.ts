/**
 * What one analysis measures with: the canonical DSP it was given, and the
 * windows, transforms and band layouts it makes from it, each made once for the
 * analysis's life however many pairs it measures (`CLAUDE.md` G5), and released
 * with it.
 */

import type { CanonicalDsp, CanonicalFft } from '@audiogubbins/audio-engine';
import type { SampleRate } from '@audiogubbins/domain';

import { blackmanHarrisWindow } from './blackman-harris.js';
import { thirdOctaveBands, type Band } from './third-octave-bands.js';

/** One analysis's measuring tools. */
export class MeasuringKit {
  readonly dsp: CanonicalDsp;
  readonly sampleRate: SampleRate;
  readonly #windows = new Map<number, Float64Array>();
  readonly #transforms = new Map<number, CanonicalFft>();
  readonly #bands = new Map<number, readonly Band[]>();

  constructor(dsp: CanonicalDsp, sampleRate: SampleRate) {
    this.dsp = dsp;
    this.sampleRate = sampleRate;
  }

  /** The Blackman–Harris window of `size` weights. */
  window(size: number): Float64Array {
    let weights = this.#windows.get(size);
    if (weights === undefined) {
      weights = blackmanHarrisWindow(size);
      this.#windows.set(size, weights);
    }
    return weights;
  }

  /** The FFT of `size`, a power of two the analysis chose within the canonical sizes. */
  fft(size: number): CanonicalFft {
    let transform = this.#transforms.get(size);
    if (transform === undefined) {
      const made = this.dsp.createFft(size);
      // Every size asked for is a power of two from 64 to 65,536, which the
      // port always makes; a refusal is a fault in the analysis.
      if (!made.ok) throw new Error(made.failures[0].summary);
      transform = made.value;
      this.#transforms.set(size, transform);
    }
    return transform;
  }

  /** The third-octave bands of a spectrum of an FFT of `size`. */
  bands(size: number): readonly Band[] {
    let bands = this.#bands.get(size);
    if (bands === undefined) {
      bands = thirdOctaveBands(this.sampleRate, size);
      this.#bands.set(size, bands);
    }
    return bands;
  }

  release(): void {
    for (const transform of this.#transforms.values()) transform.release();
    this.#transforms.clear();
  }
}
