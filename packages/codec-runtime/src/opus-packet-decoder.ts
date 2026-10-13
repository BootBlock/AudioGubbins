/**
 * Single-stream Opus packets decoded at 48 kHz by the codec module's
 * conformant decoder, with the range coder's final state after each: what
 * the RFC 6716 and RFC 8251 test vectors are decoded and checked with
 * (`pnpm test:opus-conformance`).
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import type { CodecExports } from './codec-exports.js';
import { codecFailure, planesRefused, released } from './codec-status.js';
import { BYTES, FLOATS, ModuleBuffer } from './module-buffer.js';

/** The longest packet: 120 ms at 48 kHz. */
export const MAX_OPUS_PACKET_FRAMES = 5_760;

/** A decoder of one stream of Opus packets. */
export interface OpusPacketDecoder {
  /**
   * Decodes `packet` into `into`, one plane per channel of at least
   * {@link MAX_OPUS_PACKET_FRAMES} samples, answering the frames written. A
   * packet of no bytes is a lost one, concealed as RFC 6716 describes.
   */
  decode(packet: Uint8Array, into: readonly Float32Array[]): DomainResult<number>;

  /** The range coder's final state after the last packet. */
  finalRange(): number;

  /** Releases the decoder. A second call does nothing. */
  release(): void;
}

const OBJECT = 'Opus packet decoder';

class ModuleOpusPacketDecoder implements OpusPacketDecoder {
  readonly #module: CodecExports;
  readonly #channels: number;
  readonly #packet: ModuleBuffer<Uint8Array>;
  readonly #samples: ModuleBuffer<Float32Array>;
  #handle: number;

  constructor(module: CodecExports, channels: number, handle: number) {
    this.#module = module;
    this.#channels = channels;
    this.#handle = handle;
    this.#packet = new ModuleBuffer(module, BYTES);
    this.#samples = new ModuleBuffer(module, FLOATS);
  }

  decode(packet: Uint8Array, into: readonly Float32Array[]): DomainResult<number> {
    if (this.#handle === 0) return fail(released(OBJECT));
    const capacity = into[0]?.length ?? 0;
    const fits =
      into.length === this.#channels &&
      capacity >= MAX_OPUS_PACKET_FRAMES &&
      into.every((plane) => plane.length === capacity);
    if (!fits) {
      return fail(
        planesRefused(
          OBJECT,
          `decodes into ${String(this.#channels)} planes of one length of at least ${String(MAX_OPUS_PACKET_FRAMES)} frames`,
        ),
      );
    }
    const bytes = this.#packet.holding(packet.length);
    if (bytes <= 0) return fail(codecFailure(bytes, 'ag_codec_bytes_create'));
    this.#packet.view(packet.length).set(packet);
    const samples = this.#samples.holding(this.#channels * capacity);
    if (samples <= 0) return fail(codecFailure(samples, 'ag_codec_floats_create'));
    const frames = this.#module.opusDecoderDecode(
      this.#handle,
      bytes,
      packet.length,
      samples,
      capacity,
    );
    if (frames < 0) return fail(codecFailure(frames, 'ag_opus_decoder_decode'));
    const view = this.#samples.view(this.#channels * capacity);
    into.forEach((plane, channel) => {
      plane.set(view.subarray(channel * capacity, channel * capacity + frames));
    });
    return succeed(frames);
  }

  finalRange(): number {
    return this.#handle === 0 ? -1 : this.#module.opusDecoderFinalRange(this.#handle);
  }

  release(): void {
    if (this.#handle === 0) return;
    this.#module.opusDecoderClose(this.#handle);
    this.#handle = 0;
    this.#packet.release();
    this.#samples.release();
  }
}

/** A decoder of single-stream Opus packets to one or two channels. */
export function createOpusPacketDecoder(
  module: CodecExports,
  channels: 1 | 2,
): DomainResult<OpusPacketDecoder> {
  const handle = module.opusDecoderCreate(channels);
  if (handle <= 0) return fail(codecFailure(handle, 'ag_opus_decoder_create'));
  return succeed(new ModuleOpusPacketDecoder(module, channels, handle));
}
