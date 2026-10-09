/**
 * The exports of `crates/analysis` in the DSP module (`analysis.rs` in
 * `wasm-bindings`), read alongside the rest by `readDspExports`.
 *
 * Each object reads planar samples from an `f32` buffer and writes to an
 * `f64` buffer. A push answers a status; a pull answers a count, or
 * `COUNT_BAD_HANDLE` or `COUNT_TOO_SMALL`.
 */

import type { Call } from './export-call.js';

/** The analysis functions, each answering an unsigned 32-bit integer. */
export interface AnalysisExports {
  /** An STFT of `channels`, frames of `size` samples `hop` apart, or 0. */
  readonly stftCreate: (channels: number, size: number, hop: number) => number;
  readonly stftPush: (stft: number, buffer: number, frames: number) => number;
  /** 1 where it wrote a frame's real then imaginary parts to the `f64` buffer, 0 where none was ready. */
  readonly stftPullComplex: (stft: number, output: number) => number;
  /** As `stftPullComplex`, as magnitudes then phases in turns. */
  readonly stftPullPolar: (stft: number, output: number) => number;
  readonly stftRelease: (stft: number) => number;
  readonly peakMeterCreate: (channels: number, rate: number) => number;
  readonly peakMeterPush: (meter: number, buffer: number, frames: number) => number;
  /** Writes four values a channel to the `f64` buffer: sample peak and dBFS, true peak and dBTP. */
  readonly peakMeterRead: (meter: number, output: number) => number;
  readonly peakMeterRelease: (meter: number) => number;
  /** A loudness meter weighted by the first `channels` values of the `f64` buffer `weights`, or 0. */
  readonly loudnessMeterCreate: (rate: number, weights: number, channels: number) => number;
  readonly loudnessMeterPush: (meter: number, buffer: number, frames: number) => number;
  /** Writes up to `capacity` momentary and short-term pairs, and answers how many. */
  readonly loudnessMeterPullSeries: (meter: number, output: number, capacity: number) => number;
  /** Writes the integrated loudness and the loudness range to the `f64` buffer. */
  readonly loudnessMeterRead: (meter: number, output: number) => number;
  readonly loudnessMeterRelease: (meter: number) => number;
  /** A detector of the kind `kind` codes, its settings the first `count` values of an `f64` buffer, or 0. */
  readonly detectorCreate: (
    kind: number,
    channels: number,
    rate: number,
    settings: number,
    count: number,
  ) => number;
  readonly detectorRecordWidth: (detector: number) => number;
  readonly detectorPush: (detector: number, buffer: number, frames: number) => number;
  /** Writes up to `capacity` records to the `f64` buffer, and answers how many. */
  readonly detectorPull: (detector: number, output: number, capacity: number) => number;
  readonly detectorRelease: (detector: number) => number;
}

/** The analysis functions, each read by `call`, which notes any missing. */
export function readAnalysisExports(call: (name: string) => Call): AnalysisExports {
  return {
    stftCreate: call('ag_stft_create'),
    stftPush: call('ag_stft_push'),
    stftPullComplex: call('ag_stft_pull_complex'),
    stftPullPolar: call('ag_stft_pull_polar'),
    stftRelease: call('ag_stft_release'),
    peakMeterCreate: call('ag_peak_meter_create'),
    peakMeterPush: call('ag_peak_meter_push'),
    peakMeterRead: call('ag_peak_meter_read'),
    peakMeterRelease: call('ag_peak_meter_release'),
    loudnessMeterCreate: call('ag_loudness_meter_create'),
    loudnessMeterPush: call('ag_loudness_meter_push'),
    loudnessMeterPullSeries: call('ag_loudness_meter_pull_series'),
    loudnessMeterRead: call('ag_loudness_meter_read'),
    loudnessMeterRelease: call('ag_loudness_meter_release'),
    detectorCreate: call('ag_detector_create'),
    detectorRecordWidth: call('ag_detector_record_width'),
    detectorPush: call('ag_detector_push'),
    detectorPull: call('ag_detector_pull'),
    detectorRelease: call('ag_detector_release'),
  };
}
