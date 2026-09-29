/**
 * The canonical DSP port answered by the Rust module (ADR-0031).
 *
 * Every sample crosses into the module's memory and back through a buffer the
 * module owns, read and written by a view made just before it is used: a view
 * made earlier would be of the memory's old buffer if the module had grown
 * since, and would read nothing.
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
  DspImplementation,
  type CanonicalDsp,
  type CanonicalOscillator,
  type CanonicalResampler,
  type OscillatorSettings,
  type ResamplerSettings,
} from '../canonical-dsp.js';
import { checkOscillator, checkResampler } from '../settings.js';
import { NO_ANSWER, STATUS_DONE, readDspExports, type DspExports } from './dsp-exports.js';

/** A buffer in the module's memory that grows to what it is asked to hold. */
class ModuleBuffer {
  readonly #module: DspExports;
  #handle = 0;
  #floats = 0;

  constructor(module: DspExports) {
    this.#module = module;
  }

  /** The buffer's handle, holding at least `floats` samples. */
  holding(floats: number): number {
    if (floats > this.#floats) {
      this.release();
      const handle = this.#module.bufferCreate(floats);
      if (handle === 0) {
        throw new Error(`The DSP module could not allocate ${String(floats)} samples.`);
      }
      this.#handle = handle;
      this.#floats = floats;
    }
    return this.#handle;
  }

  /** A view of the first `floats` samples, made now, of the memory as it is now. */
  view(floats: number): Float32Array {
    const address = this.#module.bufferAddress(this.#handle);
    return new Float32Array(this.#module.memoryBuffer(), address, floats);
  }

  release(): void {
    if (this.#handle !== 0) this.#module.bufferRelease(this.#handle);
    this.#handle = 0;
    this.#floats = 0;
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
      if (status !== STATUS_DONE) throw new Error('The DSP module lost an oscillator it made.');
      into.set(buffer.view(into.length));
    },
    release: () => {
      module.oscillatorRelease(handle);
      buffer.release();
    },
  });
}

/** Copies planar channels into the module and pushes them. */
function pushInto(
  module: DspExports,
  handle: number,
  buffer: ModuleBuffer,
  input: readonly Float32Array[],
): void {
  const frames = input[0]?.length ?? 0;
  const id = buffer.holding(Math.max(1, frames * input.length));
  const view = buffer.view(frames * input.length);
  input.forEach((channel, index) => {
    view.set(channel, index * frames);
  });
  if (module.resamplerPush(handle, id, frames) !== STATUS_DONE) {
    throw new Error('The resampler was given input after its end, or of the wrong shape.');
  }
}

/** Pulls into the module and copies planar channels out. */
function pullFrom(
  module: DspExports,
  handle: number,
  buffer: ModuleBuffer,
  output: readonly Float32Array[],
): number {
  const capacity = output[0]?.length ?? 0;
  const written = module.resamplerPull(
    handle,
    buffer.holding(Math.max(1, capacity * output.length)),
    capacity,
  );
  if (written === NO_ANSWER) throw new Error('The DSP module lost a resampler it made.');
  const view = buffer.view(capacity * output.length);
  output.forEach((channel, index) => {
    channel.set(view.subarray(index * capacity, index * capacity + written));
  });
  return written;
}

function resamplerIn(
  module: DspExports,
  settings: ResamplerSettings,
): DomainResult<CanonicalResampler> {
  const { from, to, channels, quality } = settings;
  const handle = module.resamplerCreate(from, to, channels, quality);
  if (handle === 0) return refusedByModule('a resampler');
  const input = new ModuleBuffer(module);
  const output = new ModuleBuffer(module);
  return succeed({
    channels,
    lookahead: module.resamplerLookahead(handle),
    push: (samples) => {
      pushInto(module, handle, input, samples);
    },
    finish: () => {
      module.resamplerFinish(handle);
    },
    pull: (samples) => pullFrom(module, handle, output, samples),
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
