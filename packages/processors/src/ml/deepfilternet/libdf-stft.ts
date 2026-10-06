/**
 * libDF's short-time Fourier transform, ported (`frame_analysis` and
 * `frame_synthesis` of `libDF/src/lib.rs`, DeepFilterNet, MIT or Apache-2.0,
 * by Hendrik Schröter and its contributors): each hop of input completes a
 * frame of the previous hop and itself, windowed by the Vorbis window
 * `sin(π/2 · sin²(π(n + ½)/N))`, transformed and scaled by `2·hop/N²`; each
 * spectrum is transformed back unscaled, windowed again, and overlapped and
 * added with the second half of the frame before. The window's squares of
 * two frames a hop apart sum to one, so analysis then synthesis gives the
 * signal back a hop late.
 *
 * libDF computes in single precision; this port computes in doubles, with
 * the canonical transform and sine, so it is the same bits on every machine.
 */

import { sineOfTurns, type CanonicalDsp } from '@audiogubbins/audio-engine';

import { BINS, FRAME, HOP } from './deepfilternet-model.js';
import { RealDft } from '../real-dft.js';
import type { Spectrum } from '../spectrum.js';

/** The Vorbis window of {@link FRAME} samples. */
function vorbisWindow(): Float64Array {
  const window = new Float64Array(FRAME);
  for (let n = 0; n < FRAME; n += 1) {
    // sin(π(n + ½)/N) is the sine of (n + ½)/2N turns; sin(π/2 · s²) of s²/4.
    const sine = sineOfTurns((n + 0.5) / (2 * FRAME));
    window[n] = sineOfTurns((sine * sine) / 4);
  }
  return window;
}

/** libDF's analysis scale, `1 / (N² / 2·hop)`, applied to the analysis alone. */
const ANALYSIS_SCALE = (2 * HOP) / (FRAME * FRAME);

/**
 * The transform and window every channel of a pass shares: neither holds
 * anything of a channel between calls, so one serves them all in turn.
 */
export class StftTransform {
  readonly dft: RealDft;
  readonly window: Float64Array;

  constructor(dsp: CanonicalDsp) {
    this.dft = RealDft.of(dsp, FRAME);
    this.window = vorbisWindow();
  }

  release(): void {
    this.dft.release();
  }
}

/** One channel's analysis and synthesis, with the hop each remembers. */
export class LibDfStft {
  readonly #dft: RealDft;
  readonly #window: Float64Array;
  /** The previous hop of input, which the next frame begins with. */
  readonly #analysisMemory = new Float64Array(FRAME - HOP);
  /** The second half of the previous frame's synthesis, which the next hop adds. */
  readonly #synthesisMemory = new Float64Array(FRAME - HOP);
  readonly #frame = new Float64Array(FRAME);

  constructor(transform: StftTransform) {
    this.#dft = transform.dft;
    this.#window = transform.window;
  }

  /** Writes to `into` the spectrum of the frame `hop`, {@link HOP} samples, completes. */
  analyse(hop: Float64Array, into: Spectrum): void {
    const split = FRAME - HOP;
    for (let n = 0; n < split; n += 1) {
      this.#frame[n] = (this.#analysisMemory[n] ?? 0) * (this.#window[n] ?? 0);
    }
    for (let n = 0; n < HOP; n += 1) {
      this.#frame[split + n] = (hop[n] ?? 0) * (this.#window[split + n] ?? 0);
    }
    this.#analysisMemory.set(hop.subarray(0, HOP));
    this.#dft.forward(this.#frame, into.real, into.imaginary);
    for (let bin = 0; bin < BINS; bin += 1) {
      into.real[bin] = (into.real[bin] ?? 0) * ANALYSIS_SCALE;
      into.imaginary[bin] = (into.imaginary[bin] ?? 0) * ANALYSIS_SCALE;
    }
  }

  /** Writes to `into` the next {@link HOP} samples of the synthesis of `spectrum`. */
  synthesise(spectrum: Spectrum, into: Float64Array): void {
    this.#dft.inverse(spectrum.real, spectrum.imaginary, this.#frame);
    for (let n = 0; n < FRAME; n += 1) {
      this.#frame[n] = (this.#frame[n] ?? 0) * (this.#window[n] ?? 0);
    }
    for (let n = 0; n < HOP; n += 1) {
      into[n] = (this.#frame[n] ?? 0) + (this.#synthesisMemory[n] ?? 0);
    }
    // The hop equals half the frame, so the memory is the frame's second half.
    this.#synthesisMemory.set(this.#frame.subarray(HOP));
  }
}
