/**
 * The canonical DSP port answered by the Rust module (ADR-0031).
 *
 * Every sample crosses into the module's memory and back through a buffer the
 * module owns, read and written by a view that is checked just before it is
 * used: a view made before the module's memory grew is of the old buffer, and
 * would read nothing, so it is made again then. Otherwise the view is kept,
 * so a call on the audio thread allocates nothing.
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
  type CanonicalOscillator,
  type CanonicalResampler,
  type OscillatorSettings,
  type ResamplerSettings,
} from '../canonical-dsp.js';
import { assertSeekFrame, checkOscillator, checkResampler, framesOfPlanar } from '../settings.js';
import {
  COUNT_BAD_HANDLE,
  COUNT_TOO_SMALL,
  DspStatus,
  readDspExports,
  type DspExports,
} from './dsp-exports.js';

/** A buffer in the module's memory that grows to what it is asked to hold. */
class ModuleBuffer {
  readonly #module: DspExports;
  #handle = 0;
  #floats = 0;
  /** The last view made, and the memory buffer it is of: made again when either changes. */
  #view = new Float32Array(0);
  #viewOf: ArrayBuffer | undefined;

  constructor(module: DspExports) {
    this.#module = module;
  }

  /**
   * The buffer's handle, holding at least `floats` samples: made on first use
   * even for none, so a call of zero frames names a buffer the module knows.
   */
  holding(floats: number): number {
    if (this.#handle === 0 || floats > this.#floats) {
      this.release();
      const handle = this.#module.bufferCreate(floats);
      if (handle === 0) {
        throw new Error(`The DSP module could not allocate ${String(floats)} samples.`);
      }
      this.#handle = handle;
      this.#floats = floats;
      this.#viewOf = undefined;
    }
    return this.#handle;
  }

  /**
   * A view of the first `floats` samples of the memory as it is now: the view
   * last made, unless the memory has grown, the buffer been made again, or
   * the length changed since.
   */
  view(floats: number): Float32Array {
    const memory = this.#module.memoryBuffer();
    if (memory !== this.#viewOf || this.#view.length !== floats) {
      const address = this.#module.bufferAddress(this.#handle);
      this.#view = new Float32Array(memory, address, floats);
      this.#viewOf = memory;
    }
    return this.#view;
  }

  release(): void {
    if (this.#handle !== 0) this.#module.bufferRelease(this.#handle);
    this.#handle = 0;
    this.#floats = 0;
    this.#viewOf = undefined;
  }
}

/**
 * Throws what a status other than done says went wrong in a call on `object`.
 * Each is a fault in the engine or the module, never in audio: the engine
 * checked the call's shape before it was made.
 */
function throwUnlessDone(status: number, object: string): void {
  switch (status) {
    case DspStatus.Done:
      return;
    case DspStatus.BadHandle:
      throw new Error(`The DSP module lost ${object} it made.`);
    case DspStatus.TooSmall:
      throw new Error(`The DSP module was given a buffer too small for a call on ${object}.`);
    case DspStatus.Refused:
      throw new Error(`The DSP module refused a call on ${object}: input after its end.`);
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
  const buffer = new ModuleBuffer(module);
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
  buffer: ModuleBuffer,
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
  buffer: ModuleBuffer,
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
  const input = new ModuleBuffer(module);
  const output = new ModuleBuffer(module);
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
  }));
}
