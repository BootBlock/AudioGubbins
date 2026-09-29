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

/** The ABI version this binding speaks; `ABI_VERSION` in `wasm-bindings`. */
const DSP_ABI_VERSION = 1;

/** The status a call answers when it did what it was asked. */
export const STATUS_DONE = 0;

/** A 32-bit answer that stands for failure where a count or address is expected. */
export const NO_ANSWER = 0xffff_ffff;

/** The module's functions, each answering an unsigned 32-bit integer or an f64. */
export interface DspExports {
  /** The module's memory, whose buffer is replaced when it grows. */
  memoryBuffer(): ArrayBuffer;
  readonly abiVersion: () => number;
  readonly bufferCreate: (floats: number) => number;
  readonly bufferAddress: (buffer: number) => number;
  readonly bufferRelease: (buffer: number) => number;
  readonly sineOfTurns: (turns: number) => number;
  readonly oscillatorCreate: (
    frequency: number,
    rate: number,
    phase: number,
    amplitude: number,
  ) => number;
  readonly oscillatorRender: (oscillator: number, buffer: number, frames: number) => number;
  readonly oscillatorRelease: (oscillator: number) => number;
  readonly resamplerCreate: (from: number, to: number, channels: number, quality: number) => number;
  readonly resamplerLookahead: (resampler: number) => number;
  readonly resamplerPush: (resampler: number, buffer: number, frames: number) => number;
  readonly resamplerFinish: (resampler: number) => number;
  readonly resamplerPull: (resampler: number, buffer: number, capacity: number) => number;
  readonly resamplerDrained: (resampler: number) => number;
  readonly resamplerRelease: (resampler: number) => number;
}

type Call = (...values: number[]) => number;

/**
 * Reads one exported function, noting it as missing where it is absent.
 *
 * A WebAssembly `i32` reaches JavaScript signed, so an unsigned answer is read
 * back with `>>> 0`; the one function that answers an `f64` is read as it is.
 */
function exported(exports: object, name: string, missing: string[], unsigned = true): Call {
  const found: unknown = Reflect.get(exports, name);
  if (typeof found !== 'function') {
    missing.push(name);
    return () => NO_ANSWER;
  }
  return (...values) => {
    const answer = Number(Reflect.apply(found, undefined, values));
    return unsigned ? answer >>> 0 : answer;
  };
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
  const read: DspExports = {
    memoryBuffer: () => bufferOf(memory) ?? new ArrayBuffer(0),
    abiVersion: call('ag_abi_version'),
    bufferCreate: call('ag_buffer_create'),
    bufferAddress: call('ag_buffer_address'),
    bufferRelease: call('ag_buffer_release'),
    sineOfTurns: exported(exports, 'ag_sine_of_turns', missing, false),
    oscillatorCreate: call('ag_oscillator_create'),
    oscillatorRender: call('ag_oscillator_render'),
    oscillatorRelease: call('ag_oscillator_release'),
    resamplerCreate: call('ag_resampler_create'),
    resamplerLookahead: call('ag_resampler_lookahead'),
    resamplerPush: call('ag_resampler_push'),
    resamplerFinish: call('ag_resampler_finish'),
    resamplerPull: call('ag_resampler_pull'),
    resamplerDrained: call('ag_resampler_drained'),
    resamplerRelease: call('ag_resampler_release'),
  };
  if (missing.length > 0) {
    return fail(
      failure(
        'dsp.module-exports-missing',
        FailureKind.Unrecoverable,
        'The DSP module lacks functions this engine calls.',
        { details: { missing: missing.join(', ') } },
      ),
    );
  }
  return speaksThisAbi(read);
}

/** The exports, if the module speaks the version of the ABI this engine does. */
function speaksThisAbi(read: DspExports): DomainResult<DspExports> {
  const version = read.abiVersion();
  if (version !== DSP_ABI_VERSION) {
    return fail(
      failure(
        'dsp.module-abi-mismatch',
        FailureKind.Unrecoverable,
        'The DSP module speaks another version of the ABI than this engine.',
        { details: { module: version, engine: DSP_ABI_VERSION } },
      ),
    );
  }
  return succeed(read);
}
