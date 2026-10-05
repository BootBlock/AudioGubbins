/**
 * The canonical DSP port answered by the Rust module (ADR-0031).
 *
 * Every sample crosses into the module's memory and back through a buffer the
 * module owns (`module-buffer.ts`), whose view is kept between calls, so a
 * call on the audio thread allocates nothing.
 */

import {
  failure,
  FailureKind,
  fail,
  flatMapResult,
  mapResult,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  CoefficientStrategy,
  DspImplementation,
  type CanonicalDsp,
  type CanonicalFft,
  type CanonicalOscillator,
  type CanonicalResampler,
  type OscillatorSettings,
  type ResamplerSettings,
} from '../canonical-dsp.js';
import {
  assertFftShape,
  assertSeekFrame,
  checkFftSize,
  checkOscillator,
  checkResampler,
  framesOfPlanar,
} from '../settings.js';
import {
  COUNT_BAD_HANDLE,
  COUNT_TOO_SMALL,
  DspStatus,
  readDspExports,
  type DspExports,
} from './dsp-exports.js';
import { DOUBLES, ModuleBuffer, SAMPLES } from './module-buffer.js';

/**
 * Throws what a status other than done says went wrong in a call on `object`.
 * Each is a fault in the engine or the module, never in audio: the engine
 * checked the call's shape before it was made.
 */
function throwUnlessDone(status: number, object: string, refusal = 'input after its end'): void {
  switch (status) {
    case DspStatus.Done:
      return;
    case DspStatus.BadHandle:
      throw new Error(`The DSP module lost ${object} it made.`);
    case DspStatus.TooSmall:
      throw new Error(`The DSP module was given a buffer too small for a call on ${object}.`);
    case DspStatus.Refused:
      throw new Error(`The DSP module refused a call on ${object}: ${refusal}.`);
    default:
      throw new Error(
        `The DSP module answered a status this engine does not know: ${String(status)}.`,
      );
  }
}

function refusedByModule(what: string): DomainResult<never> {
  return fail(
    failure(
      'dsp.module-refused',
      FailureKind.Unrecoverable,
      `The DSP module refused to make ${what}.`,
    ),
  );
}

function oscillatorIn(
  module: DspExports,
  settings: OscillatorSettings,
): DomainResult<CanonicalOscillator> {
  const { frequency, sampleRate, startPhase, amplitude } = settings;
  const handle = module.oscillatorCreate(frequency, sampleRate, startPhase, amplitude);
  if (handle === 0) return refusedByModule('an oscillator');
  const buffer = new ModuleBuffer(module, SAMPLES);
  return succeed({
    render: (into) => {
      const status = module.oscillatorRender(handle, buffer.holding(into.length), into.length);
      throwUnlessDone(status, 'an oscillator');
      into.set(buffer.view(into.length));
    },
    seek: (frame) => {
      assertSeekFrame(frame, 'An oscillator');
      throwUnlessDone(module.oscillatorSeek(handle, frame), 'an oscillator');
    },
    release: () => {
      module.oscillatorRelease(handle);
      buffer.release();
    },
  });
}

/** Copies planar channels, one per channel of the resampler, into the module and pushes them. */
function pushInto(
  module: DspExports,
  handle: number,
  buffer: ModuleBuffer<Float32Array>,
  input: readonly Float32Array[],
  channels: number,
): void {
  const frames = framesOfPlanar(input, channels);
  const id = buffer.holding(frames * channels);
  const view = buffer.view(frames * channels);
  for (let index = 0; index < channels; index += 1) {
    const channel = input[index];
    if (channel !== undefined) view.set(channel, index * frames);
  }
  throwUnlessDone(module.resamplerPush(handle, id, frames), 'a resampler');
}

/** Pulls into the module and copies planar channels, one per channel, out. */
function pullFrom(
  module: DspExports,
  handle: number,
  buffer: ModuleBuffer<Float32Array>,
  output: readonly Float32Array[],
  channels: number,
): number {
  const capacity = framesOfPlanar(output, channels);
  const written = module.resamplerPull(handle, buffer.holding(capacity * channels), capacity);
  if (written === COUNT_BAD_HANDLE) throwUnlessDone(DspStatus.BadHandle, 'a resampler');
  if (written === COUNT_TOO_SMALL) throwUnlessDone(DspStatus.TooSmall, 'a resampler');
  const view = buffer.view(capacity * channels);
  for (let index = 0; index < channels; index += 1) {
    const channel = output[index];
    if (channel === undefined) continue;
    // Element by element: a subarray to copy from would be an object a call.
    const from = index * capacity;
    for (let frame = 0; frame < written; frame += 1) channel[frame] = view[from + frame] ?? 0;
  }
  return written;
}

function resamplerIn(
  module: DspExports,
  settings: ResamplerSettings,
): DomainResult<CanonicalResampler> {
  const { from, to, channels, quality } = settings;
  const budget = settings.coefficientBudgetBytes ?? Number.POSITIVE_INFINITY;
  const handle = module.resamplerCreate(from, to, channels, quality, budget);
  if (handle === 0) return refusedByModule('a resampler');
  const tableBytes = module.resamplerTableBytes(handle);
  const input = new ModuleBuffer(module, SAMPLES);
  const output = new ModuleBuffer(module, SAMPLES);
  return succeed({
    channels,
    lookahead: module.resamplerLookahead(handle),
    // A table is never empty, so its size says which strategy the module took.
    coefficients:
      tableBytes > 0
        ? { strategy: CoefficientStrategy.Table, tableBytes }
        : { strategy: CoefficientStrategy.Computed, tableBytes: 0 },
    push: (samples) => {
      pushInto(module, handle, input, samples, channels);
    },
    finish: () => {
      throwUnlessDone(module.resamplerFinish(handle), 'a resampler');
    },
    pull: (samples) => pullFrom(module, handle, output, samples, channels),
    seek: (frame) => {
      assertSeekFrame(frame, 'A resampler');
      const start = module.resamplerSeek(handle, frame);
      if (start < 0) {
        // The frame was checked, so -1 means the handle or an input frame past 2^53.
        throw new Error(`The DSP module could not seek a resampler to frame ${String(frame)}.`);
      }
      return start;
    },
    get drained() {
      return module.resamplerDrained(handle) === 1;
    },
    release: () => {
      module.resamplerRelease(handle);
      input.release();
      output.release();
    },
  });
}

function fftIn(module: DspExports, size: number): DomainResult<CanonicalFft> {
  const handle = module.fftCreate(size);
  if (handle === 0) return refusedByModule('an FFT');
  const bins = size / 2 + 1;
  const signal = new ModuleBuffer(module, DOUBLES);
  const spectrum = new ModuleBuffer(module, DOUBLES);
  // The module refuses one buffer as both input and output, which these never are.
  const refusal = 'its input and its output in one buffer';
  return succeed({
    size,
    bins,
    forwardReal: (input, real, imaginary) => {
      assertFftShape(size, input.length, real.length, imaginary.length);
      const from = signal.holding(size);
      const to = spectrum.holding(2 * bins);
      signal.view(size).set(input);
      throwUnlessDone(module.fftForwardReal(handle, from, to), 'an FFT', refusal);
      const view = spectrum.view(2 * bins);
      // Element by element: a subarray to copy from would be an object a call.
      for (let bin = 0; bin < bins; bin += 1) {
        real[bin] = view[bin] ?? 0;
        imaginary[bin] = view[bins + bin] ?? 0;
      }
    },
    inverseReal: (real, imaginary, output) => {
      assertFftShape(size, output.length, real.length, imaginary.length);
      const from = spectrum.holding(2 * bins);
      const to = signal.holding(size);
      const view = spectrum.view(2 * bins);
      view.set(real, 0);
      view.set(imaginary, bins);
      throwUnlessDone(module.fftInverseReal(handle, from, to), 'an FFT', refusal);
      // Into a Float32Array this rounds each sample once, as the reference path does.
      output.set(signal.view(size));
    },
    release: () => {
      module.fftRelease(handle);
      signal.release();
      spectrum.release();
    },
  });
}

/**
 * The canonical DSP over an instantiated module's exports, or why the module
 * cannot serve: a missing function or another ABI version. The engine then
 * runs the reference path and says why (ADR-0031).
 */
export function wasmDsp(exports: unknown): DomainResult<CanonicalDsp> {
  return mapResult(readDspExports(exports), (module) => ({
    implementation: DspImplementation.WebAssembly,
    sineOfTurns: (turns) => module.sineOfTurns(turns),
    createOscillator: (settings) =>
      flatMapResult(checkOscillator(settings), (checked) => oscillatorIn(module, checked)),
    createResampler: (settings) =>
      flatMapResult(checkResampler(settings), (checked) => resamplerIn(module, checked)),
    createFft: (size) => flatMapResult(checkFftSize(size), (checked) => fftIn(module, checked)),
  }));
}
