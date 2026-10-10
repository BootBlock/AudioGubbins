/**
 * The codec module, instantiated and checked: the typed face of
 * `crates/codec-bindings` (ADR-0091).
 *
 * The module is compiled by the host from its own file, so the codec worker
 * loads it only when a codec it serves is used. One instance serves one
 * worker, and every object it makes is released through the wrapper that
 * made it, once.
 */

import type { SyncAudioBytes } from '@audiogubbins/codecs';
import { FailureKind, failure, fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { readCodecExports } from './codec-exports.js';
import { openDecoderSession, type DecoderSession } from './decoder-session.js';
import {
  createFlacFrameEncoder,
  type FlacFrameEncoder,
  type FlacFrameSettings,
} from './flac-frame-encoder.js';
import { HostFiles } from './host-files.js';
import { createOpusEncoder, type OpusEncoder, type OpusEncoderSettings } from './opus-encoder.js';
import { createOpusPacketDecoder, type OpusPacketDecoder } from './opus-packet-decoder.js';

/** One instance of the codec module. */
export interface CodecModule {
  /**
   * Opens a file: recognises its container from its contents, chooses its
   * default audio track and describes it. The session reads the file through
   * `source` until it is released.
   */
  openDecoder(source: SyncAudioBytes): DomainResult<DecoderSession>;

  /** An encoder of FLAC frames, for the application's FLAC writer. */
  createFlacFrameEncoder(settings: FlacFrameSettings): DomainResult<FlacFrameEncoder>;

  /** An Opus encoder, for the application's Ogg writer. */
  createOpusEncoder(settings: OpusEncoderSettings): DomainResult<OpusEncoder>;

  /** A decoder of single-stream Opus packets, as the conformance vectors carry them. */
  createOpusPacketDecoder(channels: 1 | 2): DomainResult<OpusPacketDecoder>;
}

/** Whether `code` is a compiled module, of any realm. */
function isCompiledModule(code: WebAssembly.Module | BufferSource): code is WebAssembly.Module {
  return Object.prototype.toString.call(code) === '[object WebAssembly.Module]';
}

/**
 * Instantiates the codec module from its bytes or its compiled form, checking
 * every export and the ABI version before anything is trusted.
 */
export async function instantiateCodecModule(
  code: WebAssembly.Module | BufferSource,
): Promise<DomainResult<CodecModule>> {
  const files = new HostFiles();
  const imports = { audiogubbins_codecs: { ag_codec_read: files.read } };
  let exports: unknown;
  try {
    exports = isCompiledModule(code)
      ? (await WebAssembly.instantiate(code, imports)).exports
      : (await WebAssembly.instantiate(code, imports)).instance.exports;
  } catch (error) {
    // Bytes that are not WebAssembly, or a module whose imports are not this
    // runtime's, reject here; the module's own failures are its answers.
    return fail(
      failure(
        'codec-runtime.module-instantiation-failed',
        FailureKind.Unrecoverable,
        'The codec module could not be instantiated.',
        { details: { reason: error instanceof Error ? error.name : String(error) } },
      ),
    );
  }
  const read = readCodecExports(exports);
  if (!read.ok) return read;
  const module = read.value;
  files.attach(() => module.memoryBuffer());
  return succeed({
    openDecoder: (source) => openDecoderSession(module, files, source),
    createFlacFrameEncoder: (settings) => createFlacFrameEncoder(module, settings),
    createOpusEncoder: (settings) => createOpusEncoder(module, settings),
    createOpusPacketDecoder: (channels) => createOpusPacketDecoder(module, channels),
  });
}
