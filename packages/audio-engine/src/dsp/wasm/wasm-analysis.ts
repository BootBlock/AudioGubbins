/**
 * The measuring objects of the port, answered by the Rust module through
 * `crates/analysis` (ADR-0031, ADR-0061).
 *
 * Samples cross into the module through an `f32` buffer and measures come
 * back through an `f64` buffer, each a {@link ModuleBuffer} kept between
 * calls, so a call of a steady size allocates nothing.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import {
  DETECTOR_CODES,
  STFT_OUTPUTS,
  STFT_WINDOW_CODES,
  assertLength,
  detectorValues,
  framesOf,
} from '../analysis-settings.js';
import type {
  CanonicalDetectorFeatures,
  CanonicalLoudnessMeter,
  CanonicalPeakMeter,
  CanonicalStft,
  DetectorSettings,
  LoudnessMeterSettings,
  PeakMeterSettings,
  StftSettings,
} from '../canonical-analysis.js';
import { loudnessWeights } from '../loudness-weights.js';
import { COUNT_BAD_HANDLE, COUNT_TOO_SMALL, DspStatus, type DspExports } from './dsp-exports.js';
import { DOUBLES, ModuleBuffer, SAMPLES } from './module-buffer.js';
import { refusedByModule, throwUnlessDone } from './module-status.js';

/**
 * Copies `frames` frames of planar `input`, one array per channel, into
 * `buffer`, channel `c` from `c · frames`, and answers the buffer's handle.
 */
function copyPlanar(
  buffer: ModuleBuffer<Float32Array>,
  input: readonly Float32Array[],
  frames: number,
): number {
  const handle = buffer.holding(frames * input.length);
  const view = buffer.view(frames * input.length);
  for (let channel = 0; channel < input.length; channel += 1) {
    const samples = input[channel];
    if (samples !== undefined) view.set(samples, channel * frames);
  }
  return handle;
}

/** Throws unless a count the module answered is one, naming `object`. */
function throwUnlessCount(count: number, object: string): void {
  if (count === COUNT_BAD_HANDLE) throwUnlessDone(DspStatus.BadHandle, object);
  if (count === COUNT_TOO_SMALL) throwUnlessDone(DspStatus.TooSmall, object);
}

/**
 * Copies `values` into a fresh `f64` buffer, runs `make` with its handle, and
 * releases it, answering what `make` answered: a handle, or 0 where the
 * module refused, which it also answers where it cannot make the buffer.
 */
function withValues(
  module: DspExports,
  values: ArrayLike<number>,
  make: (handle: number) => number,
): number {
  const buffer = module.bufferF64Create(values.length);
  if (buffer === 0) return 0;
  const view = new Float64Array(
    module.memoryBuffer(),
    module.bufferF64Address(buffer),
    values.length,
  );
  for (let index = 0; index < values.length; index += 1) view[index] = values[index] ?? 0;
  const made = make(buffer);
  module.bufferF64Release(buffer);
  return made;
}

/** A short-time Fourier transform in the module. */
export function stftIn(module: DspExports, settings: StftSettings): DomainResult<CanonicalStft> {
  const { channels, size, hop, window } = settings;
  const calls = module.analysis;
  const handle = calls.stftCreate(channels, size, hop, STFT_WINDOW_CODES[window]);
  if (handle === 0) return refusedByModule('a short-time Fourier transform');
  const bins = size / 2 + 1;
  const length = channels * bins;
  const input = new ModuleBuffer(module, SAMPLES);
  const output = new ModuleBuffer(module, DOUBLES);
  const pull = (first: Float64Array, second: Float64Array, polar: boolean): boolean => {
    assertLength(first, length, polar ? STFT_OUTPUTS.magnitudes : STFT_OUTPUTS.real);
    assertLength(second, length, polar ? STFT_OUTPUTS.phases : STFT_OUTPUTS.imaginary);
    const id = output.holding(2 * length);
    const answer = polar ? calls.stftPullPolar(handle, id) : calls.stftPullComplex(handle, id);
    throwUnlessCount(answer, 'a short-time Fourier transform');
    if (answer === 0) return false;
    const view = output.view(2 * length);
    // Element by element: a subarray to copy from would be an object a call.
    for (let index = 0; index < length; index += 1) {
      first[index] = view[index] ?? 0;
      second[index] = view[length + index] ?? 0;
    }
    return true;
  };
  return succeed({
    channels,
    size,
    hop,
    bins,
    push: (samples) => {
      const frames = framesOf(samples, channels, 'A short-time Fourier transform');
      const status = calls.stftPush(handle, copyPlanar(input, samples, frames), frames);
      throwUnlessDone(status, 'a short-time Fourier transform');
    },
    pullComplex: (real, imaginary) => pull(real, imaginary, false),
    pullPolar: (magnitudes, phases) => pull(magnitudes, phases, true),
    release: () => {
      calls.stftRelease(handle);
      input.release();
      output.release();
    },
  });
}

/** A peak meter in the module. */
export function peakMeterIn(
  module: DspExports,
  settings: PeakMeterSettings,
): DomainResult<CanonicalPeakMeter> {
  const { channels, sampleRate } = settings;
  const calls = module.analysis;
  const handle = calls.peakMeterCreate(channels, sampleRate);
  if (handle === 0) return refusedByModule('a peak meter');
  const input = new ModuleBuffer(module, SAMPLES);
  const output = new ModuleBuffer(module, DOUBLES);
  return succeed({
    channels,
    push: (samples) => {
      const frames = framesOf(samples, channels, 'A peak meter');
      const status = calls.peakMeterPush(handle, copyPlanar(input, samples, frames), frames);
      throwUnlessDone(status, 'a peak meter');
    },
    read: (into) => {
      assertLength(into, 4 * channels, 'A peak meter’s reading');
      throwUnlessDone(calls.peakMeterRead(handle, output.holding(into.length)), 'a peak meter');
      into.set(output.view(into.length));
    },
    release: () => {
      calls.peakMeterRelease(handle);
      input.release();
      output.release();
    },
  });
}

/** A loudness meter in the module, its channels weighted by their roles. */
export function loudnessMeterIn(
  module: DspExports,
  settings: LoudnessMeterSettings,
): DomainResult<CanonicalLoudnessMeter> {
  const weights = loudnessWeights(settings.layout);
  const channels = weights.length;
  const calls = module.analysis;
  const handle = withValues(module, weights, (id) =>
    calls.loudnessMeterCreate(settings.sampleRate, id, channels),
  );
  if (handle === 0) return refusedByModule('a loudness meter');
  const input = new ModuleBuffer(module, SAMPLES);
  const output = new ModuleBuffer(module, DOUBLES);
  return succeed({
    channels,
    push: (samples) => {
      const frames = framesOf(samples, channels, 'A loudness meter');
      const status = calls.loudnessMeterPush(handle, copyPlanar(input, samples, frames), frames);
      throwUnlessDone(status, 'a loudness meter');
    },
    pullSeries: (into) => {
      const capacity = Math.floor(into.length / 2);
      const pairs = calls.loudnessMeterPullSeries(handle, output.holding(2 * capacity), capacity);
      throwUnlessCount(pairs, 'a loudness meter');
      const view = output.view(2 * capacity);
      for (let index = 0; index < 2 * pairs; index += 1) into[index] = view[index] ?? 0;
      return pairs;
    },
    read: () => {
      throwUnlessDone(calls.loudnessMeterRead(handle, output.holding(2)), 'a loudness meter');
      const view = output.view(2);
      return { integrated: view[0] ?? 0, range: view[1] ?? 0 };
    },
    release: () => {
      calls.loudnessMeterRelease(handle);
      input.release();
      output.release();
    },
  });
}

/** A detector's feature extractor in the module. */
export function detectorIn(
  module: DspExports,
  settings: DetectorSettings,
): DomainResult<CanonicalDetectorFeatures> {
  const { kind, channels, sampleRate } = settings;
  const calls = module.analysis;
  const values = detectorValues(settings);
  const handle = withValues(module, values, (id) =>
    calls.detectorCreate(DETECTOR_CODES[kind], channels, sampleRate, id, values.length),
  );
  if (handle === 0) return refusedByModule(`a ${kind} detector`);
  const recordWidth = calls.detectorRecordWidth(handle);
  const input = new ModuleBuffer(module, SAMPLES);
  const output = new ModuleBuffer(module, DOUBLES);
  const what = `A ${kind} detector`;
  const object = `a ${kind} detector`;
  return succeed({
    kind,
    channels,
    recordWidth,
    push: (samples) => {
      const frames = framesOf(samples, channels, what);
      throwUnlessDone(
        calls.detectorPush(handle, copyPlanar(input, samples, frames), frames),
        object,
      );
    },
    pull: (into) => {
      const capacity = Math.floor(into.length / recordWidth);
      const length = capacity * recordWidth;
      const records = calls.detectorPull(handle, output.holding(length), capacity);
      throwUnlessCount(records, object);
      const view = output.view(length);
      for (let index = 0; index < records * recordWidth; index += 1) into[index] = view[index] ?? 0;
      return records;
    },
    release: () => {
      calls.detectorRelease(handle);
      input.release();
      output.release();
    },
  });
}
