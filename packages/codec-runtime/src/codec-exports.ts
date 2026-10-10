/**
 * The exports of the codec module, read and checked.
 *
 * The one place that knows the ABI of `crates/codec-bindings` (ADR-0091):
 * nothing is trusted until each function is found and the ABI version agrees.
 * A WebAssembly `i32` reaches JavaScript signed, so a handle or a count is
 * read as it is, negative for a failure; an address is read back unsigned.
 */

import { FailureKind, failure, fail, succeed, type DomainResult } from '@audiogubbins/domain';

/** The ABI version this runtime speaks; `ABI_VERSION` in `codec-bindings`. */
const CODEC_ABI_VERSION = 1;

/** A call into the module, with the arguments the ABI gives it. */
type Call = (...args: readonly number[]) => number;

/** The module's functions, by what each does. */
export interface CodecExports {
  /** The module's memory's buffer as it is now: replaced when the memory grows. */
  memoryBuffer(): ArrayBuffer;
  readonly abiVersion: Call;
  readonly bytesCreate: Call;
  readonly bytesAddress: Call;
  readonly bytesRelease: Call;
  readonly floatsCreate: Call;
  readonly floatsAddress: Call;
  readonly floatsRelease: Call;
  readonly intsCreate: Call;
  readonly intsAddress: Call;
  readonly intsRelease: Call;
  /** `(source, size)`: a session's handle. */
  readonly decoderOpen: Call;
  /** The address of a session's description record of 13 `f64`s. */
  readonly decoderDescription: Call;
  readonly decoderConfig: Call;
  /** `(session, samples, capacity)`: frames decoded, planar. */
  readonly decoderDecode: Call;
  readonly decoderReadPacket: Call;
  readonly decoderPacket: Call;
  /** An `f64`: the packet's frames, or -1. */
  readonly decoderPacketFrames: Call;
  readonly decoderClose: Call;
  /** `(channels, bits, rate, blockSize, level)`. */
  readonly flacEncoderCreate: Call;
  /** `(encoder, samples, frames, number)`: the frame's length. */
  readonly flacEncoderEncode: Call;
  readonly flacEncoderFrame: Call;
  readonly flacEncoderClose: Call;
  /** `(rate, channels, bitRate, application, duration, complexity, rateControl, inputRate)`. */
  readonly opusEncoderCreate: Call;
  readonly opusEncoderHead: Call;
  readonly opusEncoderPush: Call;
  readonly opusEncoderFinish: Call;
  readonly opusEncoderNextPacket: Call;
  readonly opusEncoderOutput: Call;
  readonly opusEncoderPacketFrames: Call;
  /** An `f64`: the end granule, or -1. */
  readonly opusEncoderEndGranule: Call;
  readonly opusEncoderClose: Call;
  readonly opusDecoderCreate: Call;
  /** `(decoder, packet, length, samples, capacity)`: frames decoded, planar. */
  readonly opusDecoderDecode: Call;
  /** An `f64`: the range coder's final state, or -1. */
  readonly opusDecoderFinalRange: Call;
  readonly opusDecoderClose: Call;
}

/** An exported function, called with the arguments the ABI gives it. */
type ExportedFunction = (...args: readonly number[]) => unknown;

function isFunction(value: unknown): value is ExportedFunction {
  return typeof value === 'function';
}

/**
 * Whether a value is an `ArrayBuffer` of any realm: the module's memory is
 * made in the realm that compiled it, which need not be the caller's.
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function bufferOf(memory: unknown): ArrayBuffer | undefined {
  if (typeof memory !== 'object' || memory === null) return undefined;
  const buffer: unknown = Reflect.get(memory, 'buffer');
  return isArrayBuffer(buffer) ? buffer : undefined;
}

/** The functions answering an address, read back unsigned. */
const ADDRESSES: ReadonlySet<string> = new Set([
  'ag_codec_abi_version',
  'ag_codec_bytes_address',
  'ag_codec_floats_address',
  'ag_codec_ints_address',
  'ag_decoder_description',
  'ag_decoder_config',
  'ag_decoder_packet',
  'ag_flac_encoder_frame',
  'ag_opus_encoder_output',
]);

/** The ABI's version and its buffers' calls. */
function bufferCalls(
  call: (name: string) => Call,
): Pick<
  CodecExports,
  | 'abiVersion'
  | 'bytesCreate'
  | 'bytesAddress'
  | 'bytesRelease'
  | 'floatsCreate'
  | 'floatsAddress'
  | 'floatsRelease'
  | 'intsCreate'
  | 'intsAddress'
  | 'intsRelease'
> {
  return {
    abiVersion: call('ag_codec_abi_version'),
    bytesCreate: call('ag_codec_bytes_create'),
    bytesAddress: call('ag_codec_bytes_address'),
    bytesRelease: call('ag_codec_bytes_release'),
    floatsCreate: call('ag_codec_floats_create'),
    floatsAddress: call('ag_codec_floats_address'),
    floatsRelease: call('ag_codec_floats_release'),
    intsCreate: call('ag_codec_ints_create'),
    intsAddress: call('ag_codec_ints_address'),
    intsRelease: call('ag_codec_ints_release'),
  };
}

/** The decode sessions' calls. */
function decoderCalls(
  call: (name: string) => Call,
): Pick<
  CodecExports,
  | 'decoderOpen'
  | 'decoderDescription'
  | 'decoderConfig'
  | 'decoderDecode'
  | 'decoderReadPacket'
  | 'decoderPacket'
  | 'decoderPacketFrames'
  | 'decoderClose'
> {
  return {
    decoderOpen: call('ag_decoder_open'),
    decoderDescription: call('ag_decoder_description'),
    decoderConfig: call('ag_decoder_config'),
    decoderDecode: call('ag_decoder_decode'),
    decoderReadPacket: call('ag_decoder_read_packet'),
    decoderPacket: call('ag_decoder_packet'),
    decoderPacketFrames: call('ag_decoder_packet_frames'),
    decoderClose: call('ag_decoder_close'),
  };
}

/** The encoders' and the Opus packet decoder's calls. */
function encoderCalls(
  call: (name: string) => Call,
): Pick<
  CodecExports,
  | 'flacEncoderCreate'
  | 'flacEncoderEncode'
  | 'flacEncoderFrame'
  | 'flacEncoderClose'
  | 'opusEncoderCreate'
  | 'opusEncoderHead'
  | 'opusEncoderPush'
  | 'opusEncoderFinish'
  | 'opusEncoderNextPacket'
  | 'opusEncoderOutput'
  | 'opusEncoderPacketFrames'
  | 'opusEncoderEndGranule'
  | 'opusEncoderClose'
  | 'opusDecoderCreate'
  | 'opusDecoderDecode'
  | 'opusDecoderFinalRange'
  | 'opusDecoderClose'
> {
  return {
    flacEncoderCreate: call('ag_flac_encoder_create'),
    flacEncoderEncode: call('ag_flac_encoder_encode'),
    flacEncoderFrame: call('ag_flac_encoder_frame'),
    flacEncoderClose: call('ag_flac_encoder_close'),
    opusEncoderCreate: call('ag_opus_encoder_create'),
    opusEncoderHead: call('ag_opus_encoder_head'),
    opusEncoderPush: call('ag_opus_encoder_push'),
    opusEncoderFinish: call('ag_opus_encoder_finish'),
    opusEncoderNextPacket: call('ag_opus_encoder_next_packet'),
    opusEncoderOutput: call('ag_opus_encoder_output'),
    opusEncoderPacketFrames: call('ag_opus_encoder_packet_frames'),
    opusEncoderEndGranule: call('ag_opus_encoder_end_granule'),
    opusEncoderClose: call('ag_opus_encoder_close'),
    opusDecoderCreate: call('ag_opus_decoder_create'),
    opusDecoderDecode: call('ag_opus_decoder_decode'),
    opusDecoderFinalRange: call('ag_opus_decoder_final_range'),
    opusDecoderClose: call('ag_opus_decoder_close'),
  };
}

/** The functions of `exports`, or why they are not the module this runtime speaks to. */
export function readCodecExports(exports: unknown): DomainResult<CodecExports> {
  if (typeof exports !== 'object' || exports === null) {
    return fail(
      failure(
        'codec-runtime.module-not-exports',
        FailureKind.Unrecoverable,
        'The codec module has no exports.',
      ),
    );
  }
  const memory: unknown = Reflect.get(exports, 'memory');
  const missing: string[] = bufferOf(memory) === undefined ? ['memory'] : [];
  const call = (name: string): Call => {
    const found: unknown = Reflect.get(exports, name);
    if (!isFunction(found)) {
      missing.push(name);
      return () => Number.NaN;
    }
    return ADDRESSES.has(name)
      ? (...args) => Number(found(...args)) >>> 0
      : (...args) => Number(found(...args));
  };
  const read: CodecExports = {
    ...bufferCalls(call),
    ...decoderCalls(call),
    ...encoderCalls(call),
    memoryBuffer: currentBuffer(memory),
  };
  return missing.length > 0 ? lacking(missing) : speaksThisAbi(read);
}

/**
 * The memory's buffer as it is now: the one last read until the memory
 * grows, which replaces it.
 */
function currentBuffer(memory: unknown): () => ArrayBuffer {
  let known = bufferOf(memory) ?? new ArrayBuffer(0);
  return () => {
    const current: unknown =
      typeof memory === 'object' && memory !== null ? Reflect.get(memory, 'buffer') : undefined;
    if (current !== known) known = bufferOf(memory) ?? new ArrayBuffer(0);
    return known;
  };
}

/** The refusal of a module without functions this runtime calls, naming every one. */
function lacking(missing: readonly string[]): DomainResult<never> {
  const names = missing.join(', ');
  return fail(
    failure(
      'codec-runtime.module-exports-missing',
      FailureKind.Unrecoverable,
      `The codec module lacks exports this runtime calls: ${names}.`,
      { details: { missing: names } },
    ),
  );
}

/** The exports, if the module speaks the version of the ABI this runtime does. */
function speaksThisAbi(read: CodecExports): DomainResult<CodecExports> {
  const version = read.abiVersion();
  if (version !== CODEC_ABI_VERSION) {
    return fail(
      failure(
        'codec-runtime.module-abi-mismatch',
        FailureKind.Unrecoverable,
        `The codec module speaks version ${String(version)} of its ABI, and this runtime speaks version ${String(CODEC_ABI_VERSION)}.`,
        { details: { module: version, runtime: CODEC_ABI_VERSION } },
      ),
    );
  }
  return succeed(read);
}
