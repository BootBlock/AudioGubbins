/**
 * FLAC frames encoded by the codec module (ADR-0091), one at a time, for the
 * application's own FLAC writer to write the stream around and compute
 * STREAMINFO from. `flacenc` encodes 8, 12, 16, 20 and 24 bits a sample, and
 * the module's own encoder every other depth FLAC allows, 32 bits among
 * them, behind the same call.
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
import { INTS, ModuleBuffer, copyOut } from './module-buffer.js';

/**
 * What a FLAC stream is encoded with. The module encodes one to eight
 * channels, 4 to 32 bits a sample, blocks of 32 to 32 767 frames, and any
 * rate a frame header can name: to 65 535 Hz, then multiples of 10 Hz to
 * 655 350 Hz.
 */
export interface FlacFrameSettings {
  /** Channels, in FLAC's own order, which is the speaker mask's. */
  readonly channels: number;
  /** Bits a sample, 4 to 32: STREAMINFO's range. */
  readonly bitsPerSample: number;
  readonly sampleRate: number;
  /** Frames in every block but the last. */
  readonly blockSize: number;
  /**
   * How hard the encoder searches, 0 to 8, after `libFLAC`'s levels: up to 2
   * the fixed predictors alone, from 3 linear prediction of order 6, 8 and
   * from 7 of 12; stereo decorrelation at every level but 0 and 3, and below
   * 32 bits a sample.
   */
  readonly level: number;
}

/** An encoder of one FLAC stream's frames. */
export interface FlacFrameEncoder {
  /**
   * Encodes the frame numbered `frameNumber` from `planes`, one per channel,
   * of one length: the block size, or fewer for the stream's last frame.
   * Each sample is an integer of the stream's bits, already quantised.
   * Answers a copy of the frame's bytes.
   */
  encodeFrame(planes: readonly Int32Array[], frameNumber: number): DomainResult<Uint8Array>;

  /** Releases the encoder. A second call does nothing. */
  release(): void;
}

const OBJECT = 'FLAC frame encoder';

/** The largest frame number a frame header holds: 31 bits. */
const MAX_FRAME_NUMBER = 2 ** 31 - 1;

class ModuleFlacFrameEncoder implements FlacFrameEncoder {
  readonly #module: CodecExports;
  readonly #settings: FlacFrameSettings;
  readonly #samples: ModuleBuffer<Int32Array>;
  #handle: number;

  constructor(module: CodecExports, settings: FlacFrameSettings, handle: number) {
    this.#module = module;
    this.#settings = settings;
    this.#handle = handle;
    this.#samples = new ModuleBuffer(module, INTS);
  }

  encodeFrame(planes: readonly Int32Array[], frameNumber: number): DomainResult<Uint8Array> {
    if (this.#handle === 0) return fail(released(OBJECT));
    if (!Number.isInteger(frameNumber) || frameNumber < 0 || frameNumber > MAX_FRAME_NUMBER) {
      return fail(settingsRefused(OBJECT, 'numbers frames from 0 to 2^31 - 1'));
    }
    const { channels } = this.#settings;
    const frames = planes[0]?.length ?? 0;
    if (planes.length !== channels || planes.some((plane) => plane.length !== frames)) {
      return fail(planesRefused(OBJECT, `takes ${String(channels)} planes of one length`));
    }
    const samples = this.#samples.holding(channels * frames);
    if (samples <= 0) return fail(codecFailure(samples, 'ag_codec_ints_create'));
    const view = this.#samples.view(channels * frames);
    planes.forEach((plane, channel) => {
      view.set(plane, channel * frames);
    });
    const length = this.#module.flacEncoderEncode(this.#handle, samples, frames, frameNumber);
    if (length < 0) return fail(codecFailure(length, 'ag_flac_encoder_encode'));
    return succeed(copyOut(this.#module, this.#module.flacEncoderFrame(this.#handle), length));
  }

  release(): void {
    if (this.#handle === 0) return;
    this.#module.flacEncoderClose(this.#handle);
    this.#handle = 0;
    this.#samples.release();
  }
}

/** An encoder of FLAC frames of these settings. */
export function createFlacFrameEncoder(
  module: CodecExports,
  settings: FlacFrameSettings,
): DomainResult<FlacFrameEncoder> {
  const { channels, bitsPerSample, sampleRate, blockSize, level } = settings;
  const whole = [channels, bitsPerSample, sampleRate, blockSize, level];
  if (!whole.every(isWholeU32)) {
    return fail(settingsRefused(OBJECT, 'takes whole numbers of channels, bits, frames and level'));
  }
  const handle = module.flacEncoderCreate(channels, bitsPerSample, sampleRate, blockSize, level);
  if (handle <= 0) return fail(codecFailure(handle, 'ag_flac_encoder_create'));
  return succeed(new ModuleFlacFrameEncoder(module, settings, handle));
}
