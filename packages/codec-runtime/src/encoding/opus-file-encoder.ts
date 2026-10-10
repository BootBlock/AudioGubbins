/**
 * Opus exports (ADR-0091): the codec module's conformant encoder, framed into
 * Ogg by the application's writer with the identification header the encoder
 * answered, so its pre-skip and channel mapping are the encoder's own. The
 * rate is held by variable bit rate, the encoder's default. The stream ends
 * at the granule position the encoder states, which trims its padding.
 */

import {
  OggOpusWriter,
  readOpusHead,
  type AudioFileWriter,
  type EncodedStreamLength,
  type SamplePlane,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { OpusEncoding } from '@audiogubbins/import-export';

import type { CodecModule } from '../codec-module.js';
import { settingsRefused } from '../codec-status.js';
import type { OpusEncoder, OpusEncoderSettings } from '../opus-encoder.js';
import type { ExportEncoderRequest } from './export-encoder-request.js';
import { Float32Planes } from './float32-planes.js';
import { framedWriter, type UnitEncoder } from './framed-file-writer.js';

/** The encoder's name, as the comment header's vendor string states it. */
const OPUS_VENDOR = 'AudioGubbins';

/** The rates Opus encodes at, which validation has held the export's to. */
const OPUS_RATES: readonly OpusEncoderSettings['sampleRate'][] = [
  8_000, 12_000, 16_000, 24_000, 48_000,
];

/** The packets of one Opus stream. */
class OpusUnits implements UnitEncoder<EncodedStreamLength> {
  readonly #encoder: OpusEncoder;
  readonly #planes = new Float32Planes();

  constructor(encoder: OpusEncoder) {
    this.#encoder = encoder;
  }

  async encode(
    planes: readonly SamplePlane[],
    frames: number,
  ): Promise<DomainResult<readonly Uint8Array[]>> {
    await Promise.resolve();
    const packets = this.#encoder.push(this.#planes.of(planes, frames));
    return packets.ok ? succeed(packets.value.map((packet) => packet.bytes)) : packets;
  }

  async finish(): Promise<
    DomainResult<{ readonly units: readonly Uint8Array[]; readonly end: EncodedStreamLength }>
  > {
    await Promise.resolve();
    const finished = this.#encoder.finish();
    if (!finished.ok) return finished;
    return succeed({
      units: finished.value.packets.map((packet) => packet.bytes),
      // The writer's end granule is the pre-skip and the frames given, at 48 kHz.
      end: { inputFrames: finished.value.endGranule - this.#encoder.preSkip },
    });
  }

  release(): void {
    this.#encoder.release();
  }
}

/** An Opus export's writer. */
export function openOpusWriter(
  request: ExportEncoderRequest,
  encoding: OpusEncoding,
  module: CodecModule,
  order: WrittenChannelOrder,
): DomainResult<AudioFileWriter> {
  const sampleRate = OPUS_RATES.find((rate) => rate === request.sampleRate);
  if (sampleRate === undefined) {
    return fail(settingsRefused('Opus encoder', 'encodes at 8, 12, 16, 24 or 48 kHz alone'));
  }
  const encoder = module.createOpusEncoder({
    sampleRate,
    channels: order.length,
    bitRate: encoding.bitRate * 1_000,
    application: encoding.application,
    frameDuration: encoding.frameDuration,
    complexity: encoding.complexity,
    rateControl: 'variable',
    inputSampleRate: request.sourceRate,
  });
  if (!encoder.ok) return encoder;
  const head = readOpusHead(encoder.value.head);
  const framer = head.ok
    ? OggOpusWriter.create({ ...head.value, vendor: OPUS_VENDOR, metadata: request.metadata })
    : head;
  if (!framer.ok) {
    encoder.value.release();
    return fail(...framer.failures);
  }
  return succeed(framedWriter(new OpusUnits(encoder.value), () => framer, order));
}
