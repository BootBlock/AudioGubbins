/**
 * The measuring objects of the canonical DSP port: what `crates/analysis`
 * computes, by the Rust module or the reference path, to the same bits
 * (ADR-0061, ADR-0032).
 *
 * Each reads planar samples, one array per channel, all of one length, in any
 * chunks: the chunking changes no bit of what it measures. Each writes what
 * it measured into arrays the caller owns, so a call allocates nothing, and
 * throws on an array of the wrong shape, which is a fault in the caller, not
 * in audio. Each is released when its owner is done with it.
 */

import type { ChannelLayout, SampleRate } from '@audiogubbins/domain';

/** How to make a short-time Fourier transform. */
export interface StftSettings {
  /** From 1 to 256. */
  readonly channels: number;
  /** `N`, the samples of a frame: a power of two from 2 to 65 536. */
  readonly size: number;
  /** The samples between the starts of two frames, from 1 to `size`. */
  readonly hop: number;
}

/**
 * A short-time Fourier transform (`stft.rs`). Frame `k` is the `N` samples
 * from sample `k · hop`, the first at the stream's first sample, times the
 * periodic Hann window `0.5 − 0.5 · cos(2πn/N)`, transformed by the canonical
 * FFT, unscaled: a full-scale sine centred on a bin has a magnitude of `N/4`
 * there. To reach the last samples of a stream, push `N − hop` zeros after
 * them.
 */
export interface CanonicalStft {
  readonly channels: number;
  readonly size: number;
  readonly hop: number;
  /** `N/2 + 1`, the bins of each channel's spectrum. */
  readonly bins: number;

  /** Appends one chunk, one array per channel, all of one length. */
  push(input: readonly Float32Array[]): void;

  /**
   * Writes the next frame, if one is ready, and answers whether it did:
   * channel `c`'s bins from `c · bins` of `real` and of `imaginary`, each
   * `channels · bins` long.
   */
  pullComplex(real: Float64Array, imaginary: Float64Array): boolean;

  /**
   * As {@link pullComplex}, as magnitudes, `√(re² + im²)`, and phases in
   * turns in `(−1/2, 1/2]`, by the canonical arctangent.
   */
  pullPolar(magnitudes: Float64Array, phases: Float64Array): boolean;

  release(): void;
}

/** How to make a peak meter. */
export interface PeakMeterSettings {
  /** From 1 to 256. */
  readonly channels: number;
  readonly sampleRate: SampleRate;
}

/**
 * Sample peak and true peak per channel (`peak.rs`). The true peak is the
 * larger of the sample peak and the peak of the signal oversampled: below 96
 * kHz by four with the recommendation's 48-tap filter, from 96 kHz by two with
 * half its phases, and from 192 kHz not at all. The filter passes a sample at
 * 0.972 of itself, so oversampled alone a full-scale impulse would read 0.245
 * dB under its sample peak.
 */
export interface CanonicalPeakMeter {
  readonly channels: number;

  /** Measures one chunk, one array per channel, all of one length. */
  push(input: readonly Float32Array[]): void;

  /**
   * Writes the peaks so far to `into`, `4 · channels` long, four values a
   * channel from `4c`: the sample peak, linear and in dBFS (−∞ for
   * silence), then the true peak, linear and in dBTP. The filter's tail is
   * included, as if the stream ended in silence where it stands.
   */
  read(into: Float64Array): void;

  release(): void;
}

/** How to make a loudness meter. */
export interface LoudnessMeterSettings {
  readonly sampleRate: SampleRate;
  /** The channels and their roles, which weight them (`loudness-weights.ts`). */
  readonly layout: ChannelLayout;
}

/** A loudness meter's reading of everything it has measured. */
export interface LoudnessReading {
  /** Integrated loudness in LUFS, gated per ITU-R BS.1770-4; −∞ where no block passes. */
  readonly integrated: number;
  /** Loudness range in LU, per EBU Tech 3342; 0 where no short-term value passes. */
  readonly range: number;
}

/**
 * Loudness per ITU-R BS.1770-4 and EBU R 128 (`loudness.rs`): K-weighted
 * mean squares over 100 ms steps, each step one momentary value (the last
 * 400 ms) and one short-term value (the last 3 s, or every step so far where
 * fewer have been measured), from the fourth step on.
 */
export interface CanonicalLoudnessMeter {
  readonly channels: number;

  /** Measures one chunk, one array per channel, all of one length. */
  push(input: readonly Float32Array[]): void;

  /**
   * Writes the momentary and short-term pairs not yet pulled, oldest first,
   * in LUFS, as many as `into` holds pairs, and answers how many.
   */
  pullSeries(into: Float64Array): number;

  read(): LoudnessReading;
  release(): void;
}

/** What a detector looks for; each kind's records are stated beside its settings. */
export const DetectorKind = {
  Clicks: 'clicks',
  Hum: 'hum',
  NoiseFloor: 'noise-floor',
  Clipping: 'clipping',
  DcOffset: 'dc-offset',
  Transients: 'transients',
  Silence: 'silence',
} as const;

/** What a detector looks for. */
export type DetectorKind = (typeof DetectorKind)[keyof typeof DetectorKind];

/** What every detector's settings hold. */
interface DetectorBasis {
  /** From 1 to 256. */
  readonly channels: number;
  readonly sampleRate: SampleRate;
}

/**
 * Clicks (`clicks.rs`): blocks of `block` samples, 64 to 2²⁰, each channel's
 * residual from an order-16 predictor fitted by Burg's method; an event of
 * `[channel, sample, deviation, MAD]` where a residual's deviation from the
 * block's median exceeds `sensitivity`, above zero, times the median
 * absolute deviation.
 */
export interface ClickSettings extends DetectorBasis {
  readonly kind: typeof DetectorKind.Clicks;
  readonly block: number;
  readonly sensitivity: number;
}

/**
 * Hum (`hum.rs`): an STFT of `size` (a power of two, 16 to 65 536), `hop`
 * apart; per channel and per frequency of 50, 100, 60 and 120 Hz,
 * `[frequency, level, floor]`: the interpolated peak within `searchWidth`
 * hertz, above zero, and the median level within `floorWidth`, wider. The
 * rate must exceed `2 · (120 + floorWidth)`.
 */
export interface HumSettings extends DetectorBasis {
  readonly kind: typeof DetectorKind.Hum;
  readonly size: number;
  readonly hop: number;
  readonly searchWidth: number;
  readonly floorWidth: number;
}

/**
 * Noise floor (`noise_floor.rs`): frames of `frame` samples, 1 to 2²⁰, `hop`
 * apart, 1 to `frame`; per channel `[level, floor]` in dBFS, the floor the
 * `percentile`, 0 to 1, of the last `history` levels, 1 to 65 536.
 */
export interface NoiseFloorSettings extends DetectorBasis {
  readonly kind: typeof DetectorKind.NoiseFloor;
  readonly frame: number;
  readonly hop: number;
  readonly percentile: number;
  readonly history: number;
}

/**
 * Clipping (`clipping.rs`): blocks of `block` samples, 1 to 2²⁰; an event of
 * `[channel, first sample, length, magnitude]` for each run of at least
 * `minimumRun` samples, 1 to `block`, within `epsilon`, zero or more, of the
 * block's largest magnitude.
 */
export interface ClippingSettings extends DetectorBasis {
  readonly kind: typeof DetectorKind.Clipping;
  readonly block: number;
  readonly epsilon: number;
  readonly minimumRun: number;
}

/**
 * DC offset (`dc_offset.rs`): per channel the mean over `window` samples, 1
 * to 2²⁰, `hop` apart, 1 to `window`.
 */
export interface DcOffsetSettings extends DetectorBasis {
  readonly kind: typeof DetectorKind.DcOffset;
  readonly window: number;
  readonly hop: number;
}

/**
 * Transients (`transients.rs`): an STFT of `size`, `hop` apart; per channel
 * `[flux, threshold]`, the half-wave rectified spectral flux and
 * `offset + multiplier · median` of the last `history` frames' flux, 1 to
 * 65 536, the multiplier and offset zero or more.
 */
export interface TransientSettings extends DetectorBasis {
  readonly kind: typeof DetectorKind.Transients;
  readonly size: number;
  readonly hop: number;
  readonly history: number;
  readonly multiplier: number;
  readonly offset: number;
}

/**
 * Silence (`silence.rs`): blocks of `block` samples, 1 to 2²⁰; an event of
 * `[first sample, length, peak, energy]` for each run of frames within a
 * block whose every channel's magnitude is at most `threshold`, zero or more:
 * the run's largest magnitude, and the sum of the squares of its samples.
 */
export interface SilenceSettings extends DetectorBasis {
  readonly kind: typeof DetectorKind.Silence;
  readonly block: number;
  readonly threshold: number;
}

/** How to make a detector's feature extractor, by what it looks for. */
export type DetectorSettings =
  | ClickSettings
  | HumSettings
  | NoiseFloorSettings
  | ClippingSettings
  | DcOffsetSettings
  | TransientSettings
  | SilenceSettings;

/**
 * A detector's feature extractor (`detectors/`): samples pushed in any
 * chunks, records pulled, each `recordWidth` values, laid out as its kind's
 * settings state. Deciding what is a finding is the detector's.
 */
export interface CanonicalDetectorFeatures {
  readonly kind: DetectorKind;
  readonly channels: number;
  readonly recordWidth: number;

  /** Appends one chunk, one array per channel, all of one length. */
  push(input: readonly Float32Array[]): void;

  /** Writes the records ready, oldest first, as many as `into` holds, and answers how many. */
  pull(into: Float64Array): number;

  release(): void;
}
