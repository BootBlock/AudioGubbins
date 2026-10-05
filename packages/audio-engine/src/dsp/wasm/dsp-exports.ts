/**
 * The exports of the canonical DSP module, read and checked.
 *
 * The one place that knows the ABI of `crates/wasm-bindings` (ADR-0031). The
 * host instantiates the module, since compiling one is the browser's or
 * Node's business and this package knows neither, and hands its exports here
 * as an unknown value; nothing is trusted until each function is found and
 * the ABI version agrees.
 */

import { failure, FailureKind, fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { readAnalysisExports, type AnalysisExports } from './analysis-exports.js';
import type { Call } from './export-call.js';

/** The ABI version this binding speaks; `ABI_VERSION` in `wasm-bindings`. */
const DSP_ABI_VERSION = 5;

/** What a call that answers a status answers; `STATUS_*` in `wasm-bindings`. */
export const DspStatus = {
  Done: 0,
  BadHandle: 1,
  Refused: 2,
  TooSmall: 3,
} as const;

/** What a call that answers a count answers for a handle that names nothing. */
export const COUNT_BAD_HANDLE = 0xffff_ffff;

/** What a call that answers a count answers for a buffer too small for it. */
export const COUNT_TOO_SMALL = 0xffff_fffe;

/**
 * The scalar primitives ADR-0061 admits, each answering an f64. The engine
 * and the processors call the reference functions themselves, which inline
 * where a call across the boundary could not; the module exports these so the
 * conformance tests can hold the two implementations to the same bits.
 */
export interface DspScalars {
  readonly cosineOfTurns: (turns: number) => number;
  readonly tangentOfTurns: (turns: number) => number;
  readonly arctangentTurns: (y: number, x: number) => number;
  readonly exp: (x: number) => number;
  readonly ln: (x: number) => number;
  readonly log2: (x: number) => number;
  readonly log10: (x: number) => number;
  readonly pow: (x: number, y: number) => number;
  readonly decibelsToGain: (decibels: number) => number;
  readonly gainToDecibels: (gain: number) => number;
}

/** The module's functions, each answering an unsigned 32-bit integer or an f64. */
export interface DspExports {
  /** The module's memory's buffer as it is now: replaced when the memory grows. */
  memoryBuffer(): ArrayBuffer;
  readonly abiVersion: () => number;
  readonly bufferCreate: (floats: number) => number;
  readonly bufferAddress: (buffer: number) => number;
  readonly bufferRelease: (buffer: number) => number;
  /** A buffer of `f64`s: a spectrum, or a signal an FFT reads at full precision. */
  readonly bufferF64Create: (doubles: number) => number;
  /** Where the `f64` buffer's values start, eight-byte aligned. */
  readonly bufferF64Address: (buffer: number) => number;
  readonly bufferF64Release: (buffer: number) => number;
  readonly sineOfTurns: (turns: number) => number;
  readonly scalars: DspScalars;
  readonly oscillatorCreate: (
    frequency: number,
    rate: number,
    phase: number,
    amplitude: number,
  ) => number;
  readonly oscillatorRender: (oscillator: number, buffer: number, frames: number) => number;
  readonly oscillatorSeek: (oscillator: number, frame: number) => number;
  readonly oscillatorRelease: (oscillator: number) => number;
  /** The budget is bytes, an f64, `Infinity` for no bound. */
  readonly resamplerCreate: (
    from: number,
    to: number,
    channels: number,
    quality: number,
    budget: number,
  ) => number;
  /** Bytes of the coefficient table, 0 where taps are computed, -1 for a bad handle; an f64. */
  readonly resamplerTableBytes: (resampler: number) => number;
  readonly resamplerLookahead: (resampler: number) => number;
  readonly resamplerPush: (resampler: number, buffer: number, frames: number) => number;
  readonly resamplerFinish: (resampler: number) => number;
  readonly resamplerPull: (resampler: number, buffer: number, capacity: number) => number;
  readonly resamplerDrained: (resampler: number) => number;
  /** The input frame to resume from, or -1; an f64 both ways. */
  readonly resamplerSeek: (resampler: number, frame: number) => number;
  readonly resamplerRelease: (resampler: number) => number;
  /** An FFT of `size` real samples, or 0 for a size that is not a power of two from 2 to 65 536. */
  readonly fftCreate: (size: number) => number;
  /**
   * Reads `N` samples from the start of the `f64` buffer `input` and writes
   * the `N/2 + 1` real parts and then the `N/2 + 1` imaginary parts of their
   * spectrum to the start of the `f64` buffer `output`.
   */
  readonly fftForwardReal: (fft: number, input: number, output: number) => number;
  /** The inverse: a spectrum laid out as the forward call writes one, back to `N` samples. */
  readonly fftInverseReal: (fft: number, input: number, output: number) => number;
  readonly fftRelease: (fft: number) => number;
  /** The measuring objects of `crates/analysis` (`analysis-exports.ts`). */
  readonly analysis: AnalysisExports;
}

/** An exported function, called with the arguments the ABI gives it. */
type ExportedFunction = (
  first: number | undefined,
  second: number | undefined,
  third: number | undefined,
  fourth: number | undefined,
  fifth: number | undefined,
) => unknown;

function isFunction(value: unknown): value is ExportedFunction {
  return typeof value === 'function';
}

/**
 * Reads one exported function, noting it as missing where it is absent.
 *
 * A WebAssembly `i32` reaches JavaScript signed, so an unsigned answer is read
 * back with `>>> 0`; the functions that answer an `f64` are read as they are.
 * The call passes five arguments rather than spreading an array, so a call on
 * the audio thread allocates nothing: an exported function ignores arguments
 * past its own, and each is given all of its own.
 */
function exported(exports: object, name: string, missing: string[], unsigned = true): Call {
  const found: unknown = Reflect.get(exports, name);
  if (!isFunction(found)) {
    missing.push(name);
    return () => COUNT_BAD_HANDLE;
  }
  return unsigned
    ? (first, second, third, fourth, fifth) =>
        Number(found(first, second, third, fourth, fifth)) >>> 0
    : (first, second, third, fourth, fifth) => Number(found(first, second, third, fourth, fifth));
}

/**
 * Whether a value is an `ArrayBuffer` of any realm. The module's memory is
 * made in the realm that compiled it, which need not be the caller's, and an
 * `instanceof` test would refuse it there.
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

/** The memory export's current buffer, or `undefined` if it has none. */
function bufferOf(memory: unknown): ArrayBuffer | undefined {
  if (typeof memory !== 'object' || memory === null) return undefined;
  const buffer: unknown = Reflect.get(memory, 'buffer');
  return isArrayBuffer(buffer) ? buffer : undefined;
}

/**
 * The memory's buffer as it is now. The memory answers the same buffer until
 * it grows, so that one is answered without checking it again: the check
 * builds a string, and this runs on every call that reads samples.
 */
function currentBuffer(memory: unknown): () => ArrayBuffer {
  let known = bufferOf(memory) ?? new ArrayBuffer(0);
  return () => {
    const buffer: unknown =
      typeof memory === 'object' && memory !== null ? Reflect.get(memory, 'buffer') : undefined;
    if (buffer !== known) known = bufferOf(memory) ?? new ArrayBuffer(0);
    return known;
  };
}

/** The functions of `exports`, or why they are not the module this binding speaks to. */
export function readDspExports(exports: unknown): DomainResult<DspExports> {
  if (typeof exports !== 'object' || exports === null) {
    return fail(
      failure(
        'dsp.module-not-exports',
        FailureKind.Unrecoverable,
        'The DSP module has no exports.',
      ),
    );
  }
  const memory: unknown = Reflect.get(exports, 'memory');
  const missing: string[] = bufferOf(memory) === undefined ? ['memory'] : [];
  const call = (name: string): Call => exported(exports, name, missing);
  const real = (name: string): Call => exported(exports, name, missing, false);
  const read: DspExports = {
    memoryBuffer: currentBuffer(memory),
    abiVersion: call('ag_abi_version'),
    bufferCreate: call('ag_buffer_create'),
    bufferAddress: call('ag_buffer_address'),
    bufferRelease: call('ag_buffer_release'),
    bufferF64Create: call('ag_buffer_f64_create'),
    bufferF64Address: call('ag_buffer_f64_address'),
    bufferF64Release: call('ag_buffer_f64_release'),
    sineOfTurns: real('ag_sine_of_turns'),
    scalars: readScalars(real),
    oscillatorCreate: call('ag_oscillator_create'),
    oscillatorRender: call('ag_oscillator_render'),
    oscillatorSeek: call('ag_oscillator_seek'),
    oscillatorRelease: call('ag_oscillator_release'),
    resamplerCreate: call('ag_resampler_create'),
    resamplerLookahead: call('ag_resampler_lookahead'),
    resamplerPush: call('ag_resampler_push'),
    resamplerFinish: call('ag_resampler_finish'),
    resamplerPull: call('ag_resampler_pull'),
    resamplerDrained: call('ag_resampler_drained'),
    resamplerSeek: real('ag_resampler_seek'),
    resamplerTableBytes: real('ag_resampler_table_bytes'),
    resamplerRelease: call('ag_resampler_release'),
    fftCreate: call('ag_fft_create'),
    fftForwardReal: call('ag_fft_forward_real'),
    fftInverseReal: call('ag_fft_inverse_real'),
    fftRelease: call('ag_fft_release'),
    analysis: readAnalysisExports(call),
  };
  return missing.length > 0 ? lacking(missing) : speaksThisAbi(read);
}

/** The refusal of a module without functions this engine calls, naming every one. */
function lacking(missing: readonly string[]): DomainResult<never> {
  const names = missing.join(', ');
  return fail(
    failure(
      'dsp.module-exports-missing',
      FailureKind.Unrecoverable,
      `The DSP module lacks exports this engine calls: ${names}.`,
      { details: { missing: names } },
    ),
  );
}

/** The scalar primitives, each read as an f64 by `real`, which notes any missing. */
function readScalars(real: (name: string) => Call): DspScalars {
  return {
    cosineOfTurns: real('ag_cosine_of_turns'),
    tangentOfTurns: real('ag_tangent_of_turns'),
    arctangentTurns: real('ag_arctangent_turns'),
    exp: real('ag_exp'),
    ln: real('ag_ln'),
    log2: real('ag_log2'),
    log10: real('ag_log10'),
    pow: real('ag_pow'),
    decibelsToGain: real('ag_decibels_to_gain'),
    gainToDecibels: real('ag_gain_to_decibels'),
  };
}

/** The exports, if the module speaks the version of the ABI this engine does. */
function speaksThisAbi(read: DspExports): DomainResult<DspExports> {
  const version = read.abiVersion();
  if (version !== DSP_ABI_VERSION) {
    return fail(
      failure(
        'dsp.module-abi-mismatch',
        FailureKind.Unrecoverable,
        `The DSP module speaks version ${String(version)} of its ABI, and this engine speaks version ${String(DSP_ABI_VERSION)}.`,
        { details: { module: version, engine: DSP_ABI_VERSION } },
      ),
    );
  }
  return succeed(read);
}
