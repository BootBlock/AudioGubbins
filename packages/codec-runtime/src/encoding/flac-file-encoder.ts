/**
 * FLAC exports (ADR-0091): the export's blocks, quantised to the stream's
 * depth, re-blocked to the encoder's fixed block size, each block encoded as
 * one frame by the codec module and framed by the application's FLAC writer,
 * which completes the stream information from the frames and the samples'
 * signature at the end.
 *
 * The block size is `libFLAC`'s for the level: 1152 frames up to level 2,
 * 4096 above. Only the last frame is shorter.
 */

import {
  FlacSampleDigest,
  FlacStreamWriter,
  type AudioFileWriter,
  type FlacStreamEnd,
  type SamplePlane,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { FlacEncoding } from '@audiogubbins/import-export';

import type { CodecModule } from '../codec-module.js';
import type { FlacFrameEncoder } from '../flac-frame-encoder.js';
import type { ExportEncodeRequest } from '../worker/codec-worker-messages.js';
import { FramedFileWriter, type UnitEncoder } from './framed-file-writer.js';

/** The encoder's name, as the stream's Vorbis comments state it. */
const FLAC_VENDOR = 'AudioGubbins';

/** `libFLAC`'s block sizes: of its fixed-predictor levels, and of every level after. */
const FIXED_LEVEL_BLOCK = 1_152;
const PREDICTIVE_LEVEL_BLOCK = 4_096;
const HIGHEST_FIXED_LEVEL = 2;

/** The frames of one FLAC stream, encoded a fixed block at a time. */
class FlacUnits implements UnitEncoder<FlacStreamEnd> {
  readonly #encoder: FlacFrameEncoder;
  readonly #digest: FlacSampleDigest;
  readonly #scale: number;
  readonly #held: readonly Int32Array[];
  #filled = 0;
  #frameNumber = 0;

  constructor(encoder: FlacFrameEncoder, bits: number, channels: number, blockSize: number) {
    this.#encoder = encoder;
    this.#digest = new FlacSampleDigest(bits);
    this.#scale = 2 ** (bits - 1);
    this.#held = Array.from({ length: channels }, () => new Int32Array(blockSize));
  }

  async encode(
    planes: readonly SamplePlane[],
    frames: number,
  ): Promise<DomainResult<readonly Uint8Array[]>> {
    await Promise.resolve();
    const units: Uint8Array[] = [];
    const blockSize = this.#held[0]?.length ?? 0;
    for (let offset = 0; offset < frames;) {
      const count = Math.min(blockSize - this.#filled, frames - offset);
      this.#held.forEach((held, channel) => {
        const plane = planes[channel];
        // Each sample is k / 2^(bits-1) exactly, quantised before it came, so this is k.
        for (let frame = 0; frame < count; frame += 1) {
          held[this.#filled + frame] = (plane?.[offset + frame] ?? 0) * this.#scale;
        }
      });
      this.#filled += count;
      offset += count;
      if (this.#filled === blockSize) {
        const frame = this.#frame();
        if (!frame.ok) return frame;
        units.push(frame.value);
      }
    }
    return succeed(units);
  }

  async finish(): Promise<
    DomainResult<{ readonly units: readonly Uint8Array[]; readonly end: FlacStreamEnd }>
  > {
    await Promise.resolve();
    const end = { samples: this.#digest };
    if (this.#filled === 0) return succeed({ units: [], end });
    const frame = this.#frame();
    return frame.ok ? succeed({ units: [frame.value], end }) : frame;
  }

  release(): void {
    this.#encoder.release();
  }

  /** The frame of the frames held, which are then gone. */
  #frame(): DomainResult<Uint8Array> {
    const planes = this.#held.map((held) => held.subarray(0, this.#filled));
    this.#digest.add(planes, this.#filled);
    const frame = this.#encoder.encodeFrame(planes, this.#frameNumber);
    this.#frameNumber += 1;
    this.#filled = 0;
    return frame;
  }
}

/** A FLAC export's writer, its blocks quantised to `encoding.bits` already. */
export function openFlacWriter(
  request: ExportEncodeRequest,
  encoding: FlacEncoding,
  module: CodecModule,
  order: WrittenChannelOrder,
): DomainResult<AudioFileWriter> {
  const blockSize =
    encoding.compressionLevel <= HIGHEST_FIXED_LEVEL ? FIXED_LEVEL_BLOCK : PREDICTIVE_LEVEL_BLOCK;
  const channels = order.length;
  const encoder = module.createFlacFrameEncoder({
    channels,
    bitsPerSample: encoding.bits,
    sampleRate: request.sampleRate,
    blockSize,
    level: encoding.compressionLevel,
  });
  if (!encoder.ok) return encoder;
  const framer = FlacStreamWriter.create({
    sampleRate: request.sampleRate,
    channels,
    bitsPerSample: encoding.bits,
    blockSize,
    metadata: request.metadata,
    vendor: FLAC_VENDOR,
    keepRiffChunks: encoding.keepRiffChunks,
  });
  if (!framer.ok) {
    encoder.value.release();
    return fail(...framer.failures);
  }
  const units = new FlacUnits(encoder.value, encoding.bits, channels, blockSize);
  return succeed(new FramedFileWriter(units, () => framer, order));
}
