/**
 * A decode session of the codec module: one file, its default audio track
 * described, then decoded in order into planar samples at its own rate, or
 * read packet by packet for a decoder outside the module (ADR-0090).
 */

import type { SyncAudioBytes } from '@audiogubbins/codecs';
import { FailureKind, failure, fail, succeed, type DomainResult } from '@audiogubbins/domain';

import type { CodecExports } from './codec-exports.js';
import { codecFailure, planesRefused, released } from './codec-status.js';
import type { HostFiles } from './host-files.js';
import { FLOATS, ModuleBuffer, copyOut } from './module-buffer.js';
import { RECORD_FIELDS, descriptionOf, type StreamDescription } from './stream-description.js';

/** One packet as its container carries it. */
export interface EncodedPacket {
  /** A copy of the packet's bytes. */
  readonly data: Uint8Array;
  /** The frames it presents, in the stream's own frames. */
  readonly frames: number;
}

/** A decode session. */
export interface DecoderSession {
  readonly description: StreamDescription;

  /**
   * Decodes into `into`, one plane per channel, all of one length, from the
   * start of each, answering the frames written: 0 only at the stream's end.
   * A failure is final: every later call answers it too.
   */
  decode(into: readonly Float32Array[]): DomainResult<number>;

  /**
   * The next packet undecoded, or `undefined` at the end. A session is
   * decoded or read by packet, never both.
   */
  readPacket(): DomainResult<EncodedPacket | undefined>;

  /** Ends the session and forgets its file. A second call does nothing. */
  release(): void;
}

/** What a session does once released, or before it is opened. */
const OBJECT = 'decode session';

class ModuleDecoderSession implements DecoderSession {
  readonly description: StreamDescription;
  readonly #module: CodecExports;
  readonly #files: HostFiles;
  readonly #source: number;
  readonly #samples: ModuleBuffer<Float32Array>;
  #handle: number;

  constructor(
    module: CodecExports,
    files: HostFiles,
    source: number,
    handle: number,
    description: StreamDescription,
  ) {
    this.#module = module;
    this.#files = files;
    this.#source = source;
    this.#handle = handle;
    this.description = description;
    this.#samples = new ModuleBuffer(module, FLOATS);
  }

  /** The failure a negative answer is, with what the file's read threw. */
  #failed(status: number, call: string): DomainResult<never> {
    return fail(codecFailure(status, call, this.#files.failureOf(this.#source)));
  }

  decode(into: readonly Float32Array[]): DomainResult<number> {
    if (this.#handle === 0) return fail(released(OBJECT));
    const channels = this.description.channelCount;
    const capacity = into[0]?.length ?? 0;
    if (
      into.length !== channels ||
      capacity === 0 ||
      into.some((plane) => plane.length !== capacity)
    ) {
      return fail(
        planesRefused(
          OBJECT,
          `decodes ${String(channels)} channels into planes of one length of at least one frame`,
        ),
      );
    }
    const samples = this.#samples.holding(channels * capacity);
    if (samples <= 0) return this.#failed(samples, 'ag_codec_floats_create');
    const frames = this.#module.decoderDecode(this.#handle, samples, capacity);
    if (frames < 0) return this.#failed(frames, 'ag_decoder_decode');
    const view = this.#samples.view(channels * capacity);
    into.forEach((plane, channel) => {
      plane.set(view.subarray(channel * capacity, channel * capacity + frames));
    });
    return succeed(frames);
  }

  readPacket(): DomainResult<EncodedPacket | undefined> {
    if (this.#handle === 0) return fail(released(OBJECT));
    const length = this.#module.decoderReadPacket(this.#handle);
    if (length < 0) return this.#failed(length, 'ag_decoder_read_packet');
    if (length === 0) return succeed(undefined);
    const data = copyOut(this.#module, this.#module.decoderPacket(this.#handle), length);
    return succeed({ data, frames: this.#module.decoderPacketFrames(this.#handle) });
  }

  release(): void {
    if (this.#handle === 0) return;
    this.#module.decoderClose(this.#handle);
    this.#handle = 0;
    this.#samples.release();
    this.#files.forget(this.#source);
  }
}

/**
 * Opens `bytes` in the module: recognises its container from its contents,
 * chooses its default audio track and describes it.
 */
export function openDecoderSession(
  module: CodecExports,
  files: HostFiles,
  bytes: SyncAudioBytes,
): DomainResult<DecoderSession> {
  const source = files.register(bytes);
  const handle = module.decoderOpen(source, bytes.size);
  if (handle <= 0) {
    const cause = files.failureOf(source);
    files.forget(source);
    return fail(codecFailure(handle, 'ag_decoder_open', cause));
  }
  const record = new Float64Array(
    module.memoryBuffer(),
    module.decoderDescription(handle),
    RECORD_FIELDS,
  ).slice();
  const configLength = record[RECORD_FIELDS - 1] ?? 0;
  const config = copyOut(module, module.decoderConfig(handle), configLength);
  const description = descriptionOf(record, config);
  if (description === undefined) {
    module.decoderClose(handle);
    files.forget(source);
    return fail(
      failure(
        'codec-runtime.module-description-unknown',
        FailureKind.Unrecoverable,
        'The codec module described a stream in codes this runtime does not know.',
      ),
    );
  }
  return succeed(new ModuleDecoderSession(module, files, source, handle, description));
}
