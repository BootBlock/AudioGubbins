/**
 * Opus encoded by the codec module's conformant encoder (ADR-0091), with
 * what the application's Ogg writer needs around the packets: the
 * identification header, each packet's duration at 48 kHz for its granule
 * positions, and the end granule that trims the last packet's padding
 * (RFC 7845, section 4). The same samples and settings give the same packets
 * on every machine.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import type { CodecExports } from './codec-exports.js';
import {
  codecFailure,
  isWholeU32,
  planesRefused,
  released,
  settingsRefused,
} from './codec-status.js';
import { FLOATS, ModuleBuffer, copyOut } from './module-buffer.js';

/** What the encoder is tuned for. */
export type OpusApplication = 'audio' | 'voip' | 'restricted-low-delay';

/** How long each packet's audio lasts, in milliseconds. */
export type OpusFrameDuration = 2.5 | 5 | 10 | 20 | 40 | 60 | 80 | 100 | 120;

/** How the bit rate is held. */
export type OpusRateControl = 'variable' | 'constrained-variable' | 'constant';

/** What an Opus stream is encoded with. */
export interface OpusEncoderSettings {
  /** The rate of the samples given: 8, 12, 16, 24 or 48 kHz. */
  readonly sampleRate: 8_000 | 12_000 | 16_000 | 24_000 | 48_000;
  /**
   * One to eight. One and two are one stream (mapping family 0); three to
   * eight are the Vorbis layouts (mapping family 1), given in speaker-mask
   * order.
   */
  readonly channels: number;
  /** The whole stream's target, in bits a second: 500 to 300 000 a channel. */
  readonly bitRate: number;
  readonly application: OpusApplication;
  readonly frameDuration: OpusFrameDuration;
  /** How hard the encoder searches, 0 to 10. */
  readonly complexity: number;
  readonly rateControl: OpusRateControl;
  /** The rate the audio had before it was brought to `sampleRate`, for the header. */
  readonly inputSampleRate?: number;
}

/** One encoded packet. */
export interface OpusPacket {
  readonly bytes: Uint8Array;
  /** The frames it decodes to at 48 kHz, by which the granule position advances. */
  readonly frames: number;
}

/** An encoder of one Opus stream. */
export interface OpusEncoder {
  /** The identification header, `OpusHead`, the stream's first Ogg packet. */
  readonly head: Uint8Array;
  /** Frames at 48 kHz the decoder discards from the start. */
  readonly preSkip: number;

  /** Takes `planes`, one per channel, of one length, answering the packets they completed. */
  push(planes: readonly Float32Array[]): DomainResult<readonly OpusPacket[]>;

  /**
   * Ends the stream, answering the packets that remained, padded so the
   * decoder gives every frame pushed, and the granule position of the
   * stream's last page.
   */
  finish(): DomainResult<{ readonly packets: readonly OpusPacket[]; readonly endGranule: number }>;

  /** Releases the encoder. A second call does nothing. */
  release(): void;
}

const OBJECT = 'Opus encoder';

/** The ABI's codes for each setting, by their place. */
const APPLICATIONS: readonly OpusApplication[] = ['audio', 'voip', 'restricted-low-delay'];
const DURATIONS: readonly OpusFrameDuration[] = [2.5, 5, 10, 20, 40, 60, 80, 100, 120];
const RATE_CONTROLS: readonly OpusRateControl[] = ['variable', 'constrained-variable', 'constant'];

class ModuleOpusEncoder implements OpusEncoder {
  readonly head: Uint8Array;
  readonly preSkip: number;
  readonly #module: CodecExports;
  readonly #channels: number;
  readonly #samples: ModuleBuffer<Float32Array>;
  #handle: number;

  constructor(module: CodecExports, channels: number, handle: number, head: Uint8Array) {
    this.#module = module;
    this.#channels = channels;
    this.#handle = handle;
    this.head = head;
    // RFC 7845: the pre-skip is the little-endian 16 bits after the
    // signature, the version and the channel count.
    this.preSkip = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
    this.#samples = new ModuleBuffer(module, FLOATS);
  }

  /** Every packet the encoder has ready. */
  #packets(): DomainResult<readonly OpusPacket[]> {
    const packets: OpusPacket[] = [];
    for (;;) {
      const length = this.#module.opusEncoderNextPacket(this.#handle);
      if (length < 0) return fail(codecFailure(length, 'ag_opus_encoder_next_packet'));
      if (length === 0) return succeed(packets);
      packets.push({
        bytes: copyOut(this.#module, this.#module.opusEncoderOutput(this.#handle), length),
        frames: this.#module.opusEncoderPacketFrames(this.#handle),
      });
    }
  }

  push(planes: readonly Float32Array[]): DomainResult<readonly OpusPacket[]> {
    if (this.#handle === 0) return fail(released(OBJECT));
    const frames = planes[0]?.length ?? 0;
    if (planes.length !== this.#channels || planes.some((plane) => plane.length !== frames)) {
      return fail(planesRefused(OBJECT, `takes ${String(this.#channels)} planes of one length`));
    }
    const samples = this.#samples.holding(this.#channels * frames);
    if (samples <= 0) return fail(codecFailure(samples, 'ag_codec_floats_create'));
    const view = this.#samples.view(this.#channels * frames);
    planes.forEach((plane, channel) => {
      view.set(plane, channel * frames);
    });
    const status = this.#module.opusEncoderPush(this.#handle, samples, frames);
    if (status < 0) return fail(codecFailure(status, 'ag_opus_encoder_push'));
    return this.#packets();
  }

  finish(): DomainResult<{ readonly packets: readonly OpusPacket[]; readonly endGranule: number }> {
    if (this.#handle === 0) return fail(released(OBJECT));
    const status = this.#module.opusEncoderFinish(this.#handle);
    if (status < 0) return fail(codecFailure(status, 'ag_opus_encoder_finish'));
    const packets = this.#packets();
    if (!packets.ok) return packets;
    return succeed({
      packets: packets.value,
      endGranule: this.#module.opusEncoderEndGranule(this.#handle),
    });
  }

  release(): void {
    if (this.#handle === 0) return;
    this.#module.opusEncoderClose(this.#handle);
    this.#handle = 0;
    this.#samples.release();
  }
}

/** An Opus encoder of these settings. */
export function createOpusEncoder(
  module: CodecExports,
  settings: OpusEncoderSettings,
): DomainResult<OpusEncoder> {
  const { sampleRate, channels, bitRate, complexity, inputSampleRate = 0 } = settings;
  const whole = [channels, bitRate, complexity, inputSampleRate];
  if (!whole.every(isWholeU32)) {
    return fail(settingsRefused(OBJECT, 'takes whole numbers of channels, bits and complexity'));
  }
  const handle = module.opusEncoderCreate(
    sampleRate,
    channels,
    bitRate,
    APPLICATIONS.indexOf(settings.application),
    DURATIONS.indexOf(settings.frameDuration),
    complexity,
    RATE_CONTROLS.indexOf(settings.rateControl),
    inputSampleRate,
  );
  if (handle <= 0) return fail(codecFailure(handle, 'ag_opus_encoder_create'));
  const length = module.opusEncoderHead(handle);
  if (length < 0) {
    module.opusEncoderClose(handle);
    return fail(codecFailure(length, 'ag_opus_encoder_head'));
  }
  const head = copyOut(module, module.opusEncoderOutput(handle), length);
  return succeed(new ModuleOpusEncoder(module, channels, handle, head));
}
