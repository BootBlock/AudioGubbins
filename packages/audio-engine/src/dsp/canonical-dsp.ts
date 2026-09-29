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

/** A sine oscillator. */
export interface CanonicalOscillator {
  /** Writes the next `into.length` samples. */
  render(into: Float32Array): void;
  release(): void;
}

/** How to make a resampler. */
export interface ResamplerSettings {
  readonly from: SampleRate;
  readonly to: SampleRate;
  readonly channels: number;
  readonly quality: ResamplingQuality;
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

/** The deterministic primitives the engine is built on. */
export interface CanonicalDsp {
  readonly implementation: DspImplementation;

  /** `sin(2π · turns)` by the canonical rule. */
  sineOfTurns(turns: number): number;

  createOscillator(settings: OscillatorSettings): DomainResult<CanonicalOscillator>;
  createResampler(settings: ResamplerSettings): DomainResult<CanonicalResampler>;
}
