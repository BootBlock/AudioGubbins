/**
 * The canonical DSP port: what the engine asks of its deterministic primitives.
 *
 * Two implementations answer it with the same bits (ADR-0032): the Rust module
 * compiled to WebAssembly (`wasm-dsp.ts`, ADR-0031) and the TypeScript
 * reference path (`reference/`), which runs where WebAssembly cannot be
 * compiled. The engine is given one and never asks which; a render made on
 * either is the same render.
 *
 * Objects made here hold state, a phase or a history, and some hold memory in
 * a WebAssembly instance, so each is released when its owner is done with it.
 */

import type { DomainResult, SampleRate } from '@audiogubbins/domain';

import type {
  CanonicalDetectorFeatures,
  CanonicalLoudnessMeter,
  CanonicalPeakMeter,
  CanonicalStft,
  DetectorSettings,
  LoudnessMeterSettings,
  PeakMeterSettings,
  StftSettings,
} from './canonical-analysis.js';

/** Which implementation answers the port. */
export const DspImplementation = {
  WebAssembly: 'webassembly',
  Reference: 'reference',
} as const;

/** Which implementation answers the port. */
export type DspImplementation = (typeof DspImplementation)[keyof typeof DspImplementation];

/**
 * How much the resampler spends on a flat passband and a deep stopband.
 *
 * Each level's stopband starts at the lower of the two Nyquist frequencies,
 * so nothing above it folds back as an alias or survives as an image louder
 * than the level's floor. The codes are the ABI's, in
 * `crates/resampling/src/quality.rs`, which designs the filters.
 */
export const ResamplingQuality = {
  /**
   * Flat within 0.00001 dB to 97 % of the lower Nyquist frequency, and at
   * least 140 dB down from it on; the default of a final render.
   */
  Maximum: 0,
  /** Flat within 0.0001 dB to 95 %, and at least 100 dB down. */
  High: 1,
  /** Flat within 0.01 dB to 90 %, and at least 60 dB down, for previews. */
  Draft: 2,
} as const;

/** How much the resampler spends on a flat passband and a deep stopband. */
export type ResamplingQuality = (typeof ResamplingQuality)[keyof typeof ResamplingQuality];

/** How to make an oscillator. */
export interface OscillatorSettings {
  /** Hertz, above zero and at most half the rate. */
  readonly frequency: number;
  readonly sampleRate: SampleRate;
  /** Where the first sample is, in turns. */
  readonly startPhase: number;
  /** The peak, in full scale. */
  readonly amplitude: number;
}

/**
 * A sine oscillator. Its phase at frame `n` of its run is defined exactly
 * (`oscillator.rs`), so it can move to any frame at once.
 */
export interface CanonicalOscillator {
  /** Writes the next `into.length` samples. */
  render(into: Float32Array): void;

  /**
   * Moves to frame `frame` of its run, a whole number, so the next sample is
   * that frame's, with the bits a run from the first frame gives it. Throws on
   * a frame that is not a whole number from 0 to `Number.MAX_SAFE_INTEGER`.
   */
  seek(frame: number): void;
  release(): void;
}

/** How to make a resampler. */
export interface ResamplerSettings {
  readonly from: SampleRate;
  readonly to: SampleRate;
  readonly channels: number;
  readonly quality: ResamplingQuality;

  /**
   * The bytes of memory the caller measured it can give the filter's table of
   * coefficients, or `undefined` where it could not tell. The table is kept
   * where it fits and can be allocated; otherwise the taps are computed as each
   * sample is written, far slower and with the same bits (REQ-ARCH-087). It
   * changes no bit of the output.
   */
  readonly coefficientBudgetBytes?: number;
}

/** Where a resampler's filter taps come from; `CoefficientStrategy` in `kernel.rs`. */
export const CoefficientStrategy = {
  /** A table of every phase's taps, each filled on first use: fast, and it holds memory. */
  Table: 'table',
  /** Each sample's taps computed as it is written: tens of times slower, in little memory. */
  Computed: 'computed',
} as const;

/** Where a resampler's filter taps come from. */
export type CoefficientStrategy = (typeof CoefficientStrategy)[keyof typeof CoefficientStrategy];

/** How a resampler came by its taps, and the memory its table holds, for a workload estimate. */
export interface ResamplerCoefficients {
  readonly strategy: CoefficientStrategy;
  /** Bytes the table holds; 0 where the taps are computed. */
  readonly tableBytes: number;
}

/**
 * A multichannel converter from one rate to another, fed in any chunks.
 *
 * Its output depends only on the input and on where each output sample falls,
 * so the chunks it is fed and pulled in never change a bit of it.
 */
export interface CanonicalResampler {
  readonly channels: number;

  /** Input frames it needs past an output sample: its latency in real time. */
  readonly lookahead: number;

  /** Where its taps come from, and what memory they hold. */
  readonly coefficients: ResamplerCoefficients;

  /**
   * Appends one chunk, one array per channel, all of one length.
   *
   * Throws on input after {@link finish} or of the wrong shape: the engine
   * owns every call, so either is a fault in the engine, not in audio.
   */
  push(input: readonly Float32Array[]): void;

  /** Marks the end of the input; the rest of the output can then be pulled. */
  finish(): void;

  /**
   * Writes the frames that are ready, up to the arrays' length, and answers
   * how many. The arrays, one per channel, are all of one length.
   */
  pull(output: readonly Float32Array[]): number;

  /**
   * Moves the stream so the next frame pulled is output frame `frame`, a
   * whole number, as if every earlier frame had been pulled from a stream run
   * from its first, and answers the input frame the next push must start at.
   *
   * The frames pulled after it have the bits the same frames have in a stream
   * run from zero, and reaching them costs nothing that grows with `frame`:
   * the input it needs starts one filter length before the frame's position.
   * An end marked by {@link finish} is forgotten. Throws on a frame that is
   * not a whole number from 0 to `Number.MAX_SAFE_INTEGER`.
   */
  seek(frame: number): number;

  /** Whether every output frame has been pulled. */
  readonly drained: boolean;

  release(): void;
}

/** The fewest and the most samples an FFT takes: the powers of two between are its sizes. */
export const SMALLEST_FFT_SIZE = 2;
export const LARGEST_FFT_SIZE = 65_536;

/**
 * The FFT of real signals of one size `N` (`fft.rs`), with the tables and
 * scratch it made when it was made, so a transform allocates nothing.
 *
 * A spectrum is `N/2 + 1` bins, from 0 Hz to half the rate, held as two
 * arrays, the real parts and the imaginary parts, rather than one array of
 * pairs, so a magnitude or a phase reads each part at its bin. The forward
 * transform is unscaled (a full-scale sine of `N` samples centred on a bin has
 * a magnitude of `N/2` there) and the inverse scales by `1/N`, so the inverse
 * of the forward transform is the signal.
 *
 * Each call throws on an array of the wrong length: the caller owns every
 * array, so a wrong length is a fault in the caller, not in audio.
 */
export interface CanonicalFft {
  /** `N`, the samples of a signal. */
  readonly size: number;
  /** `N/2 + 1`, the bins of a spectrum. */
  readonly bins: number;

  /**
   * Writes the spectrum of `signal`, `N` samples, to `real` and `imaginary`,
   * `N/2 + 1` bins each: bin `k` is `Σ signal[n] · e^(−2πikn/N)`. The
   * imaginary parts of bins 0 and `N/2` are zero.
   */
  forwardReal(
    signal: Float32Array | Float64Array,
    real: Float64Array,
    imaginary: Float64Array,
  ): void;

  /**
   * Writes the `N` samples whose spectrum is `real` and `imaginary` to
   * `signal`, scaled by `1/N`; the imaginary parts of bins 0 and `N/2` are
   * taken as zero, as a real signal's are. A `Float32Array` receives each
   * sample rounded once.
   */
  inverseReal(
    real: Float64Array,
    imaginary: Float64Array,
    signal: Float32Array | Float64Array,
  ): void;

  release(): void;
}

/** The deterministic primitives the engine is built on. */
export interface CanonicalDsp {
  readonly implementation: DspImplementation;

  /** `sin(2π · turns)` by the canonical rule. */
  sineOfTurns(turns: number): number;

  createOscillator(settings: OscillatorSettings): DomainResult<CanonicalOscillator>;
  createResampler(settings: ResamplerSettings): DomainResult<CanonicalResampler>;

  /**
   * An FFT of `size` real samples, a power of two from
   * {@link SMALLEST_FFT_SIZE} to {@link LARGEST_FFT_SIZE}, or why not.
   */
  createFft(size: number): DomainResult<CanonicalFft>;

  /** A short-time Fourier transform (`canonical-analysis.ts`), or why not. */
  createStft(settings: StftSettings): DomainResult<CanonicalStft>;

  /** A sample-peak and true-peak meter, or why not. */
  createPeakMeter(settings: PeakMeterSettings): DomainResult<CanonicalPeakMeter>;

  /** A loudness meter, its channels weighted by their roles, or why not. */
  createLoudnessMeter(settings: LoudnessMeterSettings): DomainResult<CanonicalLoudnessMeter>;

  /** The feature extractor of the detector `settings` name by kind, or why not. */
  createDetectorFeatures(settings: DetectorSettings): DomainResult<CanonicalDetectorFeatures>;
}
