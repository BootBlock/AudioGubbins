/**
 * Spleeter's short-time Fourier transform, ported from what its model runs
 * (`_build_stft_feature` and `_inverse_stft` of `spleeter/model/__init__.py`,
 * Spleeter, MIT, by Deezer), which are TensorFlow's `tf.signal.stft` and
 * `tf.signal.inverse_stft`: each frame of 4 096 samples is windowed by the
 * periodic Hann window `½ − ½·cos(2πn/N)` and transformed; each spectrum is
 * transformed back, scaled by `1/N`, windowed by the same window again, and
 * overlapped and added a hop apart. The two windows a quarter frame apart sum
 * to 3/2, which Spleeter's 2/3 undoes where the caller writes the sum.
 *
 * TensorFlow computes in single precision; this port computes in doubles,
 * on the canonical FFT and cosine, so it is the same bits on every machine.
 */

import { cosineOfTurns, type CanonicalDsp, type CanonicalFft } from '@audiogubbins/audio-engine';

import type { Spectrum } from '../spectrum.js';
import { FRAME } from './spleeter-model.js';

/** The periodic Hann window of {@link FRAME} samples. */
function periodicHann(): Float64Array {
  return Float64Array.from({ length: FRAME }, (_, n) => 0.5 - 0.5 * cosineOfTurns(n / FRAME));
}

/**
 * The transform and window of a pass: neither holds anything of a frame
 * between calls, so one serves every channel in turn.
 */
export class SpleeterStft {
  readonly #fft: CanonicalFft;
  readonly #window = periodicHann();
  readonly #frame = new Float64Array(FRAME);

  constructor(dsp: CanonicalDsp) {
    const fft = dsp.createFft(FRAME);
    // The size is this module's constant, a power of two the FFT takes, so a
    // refusal is a fault in the engine, not something a stream brings about.
    if (!fft.ok) throw new Error(`No FFT serves a transform of ${String(FRAME)}.`);
    this.#fft = fft.value;
  }

  /** Writes to `into` the spectrum of the frame of `samples` that starts at `start`. */
  analyse(samples: Float32Array, start: number, into: Spectrum): void {
    for (let n = 0; n < FRAME; n += 1) {
      this.#frame[n] = (samples[start + n] ?? 0) * (this.#window[n] ?? 0);
    }
    this.#fft.forwardReal(this.#frame, into.real, into.imaginary);
  }

  /** Adds the windowed inverse of `spectrum` to `into`, from `start`. */
  synthesise(spectrum: Spectrum, into: Float64Array, start: number): void {
    this.#fft.inverseReal(spectrum.real, spectrum.imaginary, this.#frame);
    for (let n = 0; n < FRAME; n += 1) {
      into[start + n] = (into[start + n] ?? 0) + (this.#frame[n] ?? 0) * (this.#window[n] ?? 0);
    }
  }

  release(): void {
    this.#fft.release();
  }
}
