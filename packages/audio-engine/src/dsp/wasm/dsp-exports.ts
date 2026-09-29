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
const DSP_ABI_VERSION = 2;

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

/** The module's functions, each answering an unsigned 32-bit integer or an f64. */
export interface DspExports {
  /** The module's memory's buffer as it is now: replaced when the memory grows. */
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
  /** The input frame to resume from, or -1; an f64 both ways. */
  readonly resamplerSeek: (resampler: number, frame: number) => number;
  readonly resamplerRelease: (resampler: number) => number;
}

/** A call into the module: no export takes more than four arguments. */
type Call = (first?: number, second?: number, third?: number, fourth?: number) => number;

/** An exported function, called with the arguments the ABI gives it. */
type ExportedFunction = (
  first: number | undefined,
  second: number | undefined,
  third: number | undefined,
  fourth: number | undefined,
) => unknown;

function isFunction(value: unknown): value is ExportedFunction {
  return typeof value === 'function';
}

/**
 * Reads one exported function, noting it as missing where it is absent.
 *
 * A WebAssembly `i32` reaches JavaScript signed, so an unsigned answer is read
 * back with `>>> 0`; the functions that answer an `f64` are read as they are.
 * The call passes four arguments rather than spreading an array, so a call on
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
    ? (first, second, third, fourth) => Number(found(first, second, third, fourth)) >>> 0
    : (first, second, third, fourth) => Number(found(first, second, third, fourth));
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
  const read: DspExports = {
    memoryBuffer: currentBuffer(memory),
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
    resamplerSeek: exported(exports, 'ag_resampler_seek', missing, false),
    resamplerRelease: call('ag_resampler_release'),
  };
  if (missing.length > 0) {
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
        `The DSP module speaks version ${String(version)} of its ABI, and this engine speaks version ${String(DSP_ABI_VERSION)}.`,
        { details: { module: version, engine: DSP_ABI_VERSION } },
      ),
    );
  }
  return succeed(read);
}
