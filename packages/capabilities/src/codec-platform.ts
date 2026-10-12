/**
 * The browser's codecs and WebAssembly, read once from a global scope and
 * probed (ADR-0090, ADR-0091, REQ-EXEC-216).
 *
 * The codec worker runs the codec module, which needs WebAssembly, and the
 * browser's own WebCodecs classes, which only add to it: HE-AAC decoding and
 * AAC-LC encoding, where a browser has them. Neither is assumed. This module
 * reads the scope it is given, a worker's or a page's, for both, and hands
 * the classes on as typed values, so the codec runtime calls them without
 * ever asking the browser what it has; and it probes each codec with
 * `isConfigSupported` on representative configurations, and the bit rates
 * the AAC encoder takes stream by stream (`aac-bit-rate-probe.ts`), answering
 * the part of a `CodecEnvironment` the browser decides. The codec worker
 * probes once, as it starts, and the page keeps what it found for the
 * session.
 *
 * The classes are named here by the members the codec runtime uses, so a test
 * hands fakes of the same shape and a scope that lacks a member offers
 * nothing rather than something half usable.
 */

import type { BitRateBand, CodecEnvironment, CodecId } from '@audiogubbins/codecs';
import { throwIfCancelled, type CancellationSignal } from '@audiogubbins/domain';

import { probeAacBitRates } from './aac-bit-rate-probe.js';
import { method } from './browser-reads.js';
import {
  supports,
  type AskSupport,
  type ConfigSupport,
  type WebCodecsAudioConfig,
} from './config-support.js';
import { browserFamilyOf, type BrowserFamily } from './platform.js';

/** The options of `AudioData.copyTo` the runtime uses: one plane of 32-bit floats. */
export interface PlaneCopy {
  readonly planeIndex: number;
  readonly format: 'f32-planar';
  readonly frameOffset?: number;
  readonly frameCount?: number;
}

/** Decoded audio, as WebCodecs answers it. */
export interface AudioDataLike {
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  copyTo(destination: Float32Array, options: PlaneCopy): void;
  close(): void;
}

/** What a chunk of encoded audio is made from. */
export interface EncodedAudioChunkInit {
  readonly type: 'key' | 'delta';
  /** Microseconds. */
  readonly timestamp: number;
  readonly duration?: number;
  readonly data: Uint8Array;
}

/** A chunk of encoded audio, given to a decoder and taken from an encoder. */
export interface EncodedAudioChunkLike {
  readonly byteLength: number;
  readonly timestamp: number;
  copyTo(destination: Uint8Array): void;
}

/** WebCodecs' `EncodedAudioChunk` class. */
export type EncodedAudioChunkClass = new (init: EncodedAudioChunkInit) => EncodedAudioChunkLike;

/** A codec's state, as WebCodecs names it. */
export type CodecState = 'unconfigured' | 'configured' | 'closed';

/** What a decoder calls back with. */
export interface AudioDecoderCallbacks {
  readonly output: (data: AudioDataLike) => void;
  readonly error: (error: Error) => void;
}

/** A WebCodecs audio decoder. */
export interface AudioDecoderLike {
  readonly state: CodecState;
  readonly decodeQueueSize: number;
  configure(config: WebCodecsAudioConfig): void;
  decode(chunk: EncodedAudioChunkLike): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener(type: 'dequeue', listener: () => void): void;
  removeEventListener(type: 'dequeue', listener: () => void): void;
}

/** WebCodecs' `AudioDecoder` class. */
export interface AudioDecoderClass {
  new (callbacks: AudioDecoderCallbacks): AudioDecoderLike;
  isConfigSupported(config: WebCodecsAudioConfig): Promise<ConfigSupport>;
}

/** What audio to encode is made from: planar 32-bit floats. */
export interface AudioDataInit {
  readonly format: 'f32-planar';
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  /** Microseconds. */
  readonly timestamp: number;
  readonly data: Float32Array;
}

/** WebCodecs' `AudioData` class. */
export type AudioDataClass = new (init: AudioDataInit) => AudioDataLike;

/** What an encoder states beside a chunk: the codec's configuration, with the first. */
export interface EncodedAudioChunkMetadata {
  readonly decoderConfig?: { readonly description?: unknown };
}

/** What an encoder calls back with. */
export interface AudioEncoderCallbacks {
  readonly output: (chunk: EncodedAudioChunkLike, metadata?: EncodedAudioChunkMetadata) => void;
  readonly error: (error: Error) => void;
}

/** A WebCodecs audio encoder. */
export interface AudioEncoderLike {
  readonly state: CodecState;
  readonly encodeQueueSize: number;
  configure(config: WebCodecsAudioConfig): void;
  encode(data: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener(type: 'dequeue', listener: () => void): void;
  removeEventListener(type: 'dequeue', listener: () => void): void;
}

/** WebCodecs' `AudioEncoder` class. */
export interface AudioEncoderClass {
  new (callbacks: AudioEncoderCallbacks): AudioEncoderLike;
  isConfigSupported(config: WebCodecsAudioConfig): Promise<ConfigSupport>;
}

/** The classes the browser decodes with. */
export interface BrowserAudioDecoding {
  readonly AudioDecoder: AudioDecoderClass;
  readonly EncodedAudioChunk: EncodedAudioChunkClass;
}

/** The classes the browser encodes with. */
export interface BrowserAudioEncoding {
  readonly AudioEncoder: AudioEncoderClass;
  readonly AudioData: AudioDataClass;
}

/** What a scope offers the codecs, read once. */
export interface CodecPlatform {
  /** Whether the scope compiles WebAssembly, which the codec module and the encoder modules are. */
  readonly webAssembly: boolean;
  readonly decoding: BrowserAudioDecoding | undefined;
  readonly encoding: BrowserAudioEncoding | undefined;
  /** The browser's family and major version, which names a browser codec's version. */
  readonly browser: BrowserFamily | undefined;
}

/** The part of a `CodecEnvironment` the browser decides, as the probes found it. */
export type CodecProbes = Pick<
  CodecEnvironment,
  'webAssembly' | 'browserDecoders' | 'browserEncoders' | 'browserBitRates'
>;

/**
 * The smallest module WebAssembly accepts. Compiled rather than the global
 * looked for, because a security policy without `'wasm-unsafe-eval'` leaves
 * the global in place and refuses every compilation.
 */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** Whether a value is a class with every one of `statics` as a function. */
function isClassWith(value: unknown, statics: readonly string[]): boolean {
  return (
    typeof value === 'function' &&
    statics.every((name) => typeof Reflect.get(value, name) === 'function')
  );
}

function isAudioDecoderClass(value: unknown): value is AudioDecoderClass {
  return isClassWith(value, ['isConfigSupported']);
}

function isAudioEncoderClass(value: unknown): value is AudioEncoderClass {
  return isClassWith(value, ['isConfigSupported']);
}

function isEncodedAudioChunkClass(value: unknown): value is EncodedAudioChunkClass {
  return isClassWith(value, []);
}

function isAudioDataClass(value: unknown): value is AudioDataClass {
  return isClassWith(value, []);
}

/**
 * Reads a member of the scope, refused the same as absent: a hardened
 * browser may throw rather than answer.
 */
function memberOf(scope: object, name: string): unknown {
  try {
    return Reflect.get(scope, name);
  } catch (error) {
    if (error instanceof DOMException) return undefined;
    throw error;
  }
}

/** Whether the scope compiles a module: a policy that forbids it throws on compiling. */
function compilesWebAssembly(scope: object): boolean {
  const webAssembly = memberOf(scope, 'WebAssembly');
  const compile: unknown =
    typeof webAssembly === 'object' && webAssembly !== null
      ? Reflect.get(webAssembly, 'Module')
      : undefined;
  if (typeof compile !== 'function') return false;
  try {
    Reflect.construct(compile, [EMPTY_MODULE]);
    return true;
  } catch (error) {
    // A `CompileError` from a security policy, or anything a stand-in throws:
    // a scope that cannot compile the smallest module compiles none.
    if (error instanceof Error) return false;
    throw error;
  }
}

/** The browser's family, from the scope's navigator, where it states one. */
function browserOf(scope: object): BrowserFamily | undefined {
  const navigatorLike = memberOf(scope, 'navigator');
  const agent: unknown =
    typeof navigatorLike === 'object' && navigatorLike !== null
      ? Reflect.get(navigatorLike, 'userAgent')
      : undefined;
  return typeof agent === 'string' ? browserFamilyOf(agent) : undefined;
}

/**
 * What a page's or a worker's global scope offers the codecs. Each pair of
 * classes is offered only whole: a decoder without the chunk class it is fed
 * with cannot decode.
 */
export function readCodecPlatform(scope: object): CodecPlatform {
  const decoder = memberOf(scope, 'AudioDecoder');
  const chunk = memberOf(scope, 'EncodedAudioChunk');
  const encoder = memberOf(scope, 'AudioEncoder');
  const data = memberOf(scope, 'AudioData');
  return {
    webAssembly: compilesWebAssembly(scope),
    decoding:
      isAudioDecoderClass(decoder) && isEncodedAudioChunkClass(chunk)
        ? { AudioDecoder: decoder, EncodedAudioChunk: chunk }
        : undefined,
    encoding:
      isAudioEncoderClass(encoder) && isAudioDataClass(data)
        ? { AudioEncoder: encoder, AudioData: data }
        : undefined,
    browser: browserOf(scope),
  };
}

/** A codec, and the configurations each of which the browser must support for it to count. */
interface CodecProbe {
  readonly codec: CodecId;
  readonly configs: readonly WebCodecsAudioConfig[];
}

const STEREO_44K = { sampleRate: 44_100, numberOfChannels: 2 } as const;
const STEREO_48K = { sampleRate: 48_000, numberOfChannels: 2 } as const;

/**
 * FLAC's `fLaC` and a stream information block for 16-bit stereo at 44.1 kHz,
 * which the registry asks a FLAC decoder's configuration to carry: blocks of
 * 4,096, frames and length unknown, no signature.
 */
const FLAC_DESCRIPTION = new Uint8Array([
  0x66, 0x4c, 0x61, 0x43, 0x80, 0x00, 0x00, 0x22, 0x10, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x0a, 0xc4, 0x42, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/**
 * What the browser's decoder is asked. HE-AAC counts only where both its
 * forms decode, SBR (`mp4a.40.5`) and SBR with parametric stereo
 * (`mp4a.40.29`), since a file is refused or decoded by its codec and both
 * forms are that codec (ADR-0091). The rest are asked for information: no
 * local decoder gives way to them (the packet's forbidden shortcuts).
 */
const DECODER_PROBES: readonly CodecProbe[] = [
  {
    codec: 'he-aac',
    configs: [
      { codec: 'mp4a.40.5', ...STEREO_44K },
      { codec: 'mp4a.40.29', ...STEREO_44K },
    ],
  },
  { codec: 'aac-lc', configs: [{ codec: 'mp4a.40.2', ...STEREO_44K }] },
  { codec: 'mp3', configs: [{ codec: 'mp3', ...STEREO_44K }] },
  { codec: 'opus', configs: [{ codec: 'opus', ...STEREO_48K }] },
  { codec: 'flac', configs: [{ codec: 'flac', ...STEREO_44K, description: FLAC_DESCRIPTION }] },
];

/**
 * What the browser's encoder is asked for information. AAC-LC, which only the
 * browser encodes (ADR-0091), is asked for every stream and bit rate apart
 * (`probeAacBitRates`), and counts where it takes any.
 */
const ENCODER_PROBES: readonly CodecProbe[] = [
  { codec: 'opus', configs: [{ codec: 'opus', ...STEREO_48K, bitrate: 128_000 }] },
  { codec: 'flac', configs: [{ codec: 'flac', ...STEREO_44K }] },
  { codec: 'mp3', configs: [{ codec: 'mp3', ...STEREO_44K, bitrate: 192_000 }] },
  { codec: 'vorbis', configs: [{ codec: 'vorbis', ...STEREO_44K, bitrate: 192_000 }] },
];

/**
 * The codecs every configuration of whose probe the browser supports, asked
 * one configuration at a time, so the probes hold one request open at most.
 */
async function supported(
  ask: AskSupport | undefined,
  probes: readonly CodecProbe[],
  signal: CancellationSignal | undefined,
): Promise<Set<CodecId>> {
  const found = new Set<CodecId>();
  if (ask === undefined) return found;
  for (const probe of probes) {
    let all = true;
    for (const config of probe.configs) {
      throwIfCancelled(signal);
      if (!(await supports(ask, config))) {
        all = false;
        break;
      }
    }
    if (all) found.add(probe.codec);
  }
  return found;
}

/**
 * What the browser decides of the codecs here: WebAssembly, what its codecs
 * decode and encode, and the bit rates its AAC encoder takes. Throws the
 * cancellation's reason once `signal` is cancelled, asking nothing more.
 */
export async function probeCodecs(
  platform: CodecPlatform,
  signal?: CancellationSignal,
): Promise<CodecProbes> {
  const decoding = method(platform.decoding?.AudioDecoder, 'isConfigSupported');
  const encoding = method(platform.encoding?.AudioEncoder, 'isConfigSupported');
  const browserDecoders = await supported(decoding, DECODER_PROBES, signal);
  const browserEncoders = await supported(encoding, ENCODER_PROBES, signal);
  const aac = encoding === undefined ? [] : await probeAacBitRates(encoding, signal);
  const browserBitRates = new Map<CodecId, readonly BitRateBand[]>();
  if (aac.length > 0) {
    browserEncoders.add('aac-lc');
    browserBitRates.set('aac-lc', aac);
  }
  return { webAssembly: platform.webAssembly, browserDecoders, browserEncoders, browserBitRates };
}
