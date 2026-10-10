/**
 * The Opus identification header (RFC 7845, section 5.1) and the duration of
 * an Opus packet read from its table-of-contents byte (RFC 6716, section 3.1).
 *
 * The header states the channel count, the pre-skip the decoder discards, the
 * rate the source was at, the output gain and the channel mapping: family 0
 * for mono and stereo in one stream, family 1 for up to eight channels in
 * Vorbis order across several streams. Settings the header cannot state are
 * refused before anything is written.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { ByteWriter } from './byte-writer.js';
import { invalidEncodedStream, unwritableStream } from './framing-failures.js';

/** How the decoded streams map to output channels. */
export type OpusChannelMapping =
  | { readonly family: 0 }
  | {
      readonly family: 1;

      /** The number of Opus streams in each packet. */
      readonly streams: number;

      /** How many of the streams are coupled stereo pairs, which come first. */
      readonly coupledStreams: number;

      /** For each output channel, the decoded channel it takes, or 255 for silence. */
      readonly table: readonly number[];
    };

/** What an identification header states. */
export interface OpusHeadSettings {
  readonly channels: number;

  /** The samples at 48 kHz the decoder discards from the start. */
  readonly preSkip: number;

  /** The source's rate, for a player that wants to give it back; 0 where unknown. */
  readonly inputRate: number;

  /** The gain to apply on output, in 1/256 dB, as a signed 16-bit value. */
  readonly outputGain: number;
  readonly mapping: OpusChannelMapping;
}

const OPUS_HEAD = 'OpusHead';

/** The most channels mapping family 1 serves. */
const FAMILY_1_MAXIMUM_CHANNELS = 8;

const inRange = (value: number, low: number, high: number): boolean =>
  Number.isInteger(value) && value >= low && value <= high;

/** Why the settings cannot be stated, or `undefined` where they can. */
function settingsProblem(settings: OpusHeadSettings): string | undefined {
  const { channels, mapping } = settings;
  if (!inRange(settings.preSkip, 0, 0xffff)) return 'An Opus pre-skip must be 0 to 65535 samples.';
  if (!inRange(settings.inputRate, 0, 0xffffffff)) return 'An Opus input rate must fit 32 bits.';
  if (!inRange(settings.outputGain, -0x8000, 0x7fff)) {
    return 'An Opus output gain must fit a signed 16-bit value.';
  }
  if (mapping.family === 0) {
    return inRange(channels, 1, 2) ? undefined : 'Opus mapping family 0 holds one or two channels.';
  }
  if (!inRange(channels, 1, FAMILY_1_MAXIMUM_CHANNELS)) {
    return 'Opus mapping family 1 holds one to eight channels.';
  }
  const decoded = mapping.streams + mapping.coupledStreams;
  if (
    !inRange(mapping.streams, 1, 255) ||
    !inRange(mapping.coupledStreams, 0, mapping.streams) ||
    decoded > 255
  ) {
    return 'An Opus stream count must be 1 to 255, with no more coupled streams than streams.';
  }
  if (mapping.table.length !== channels) {
    return 'An Opus channel mapping table must name one decoded channel for each output channel.';
  }
  if (!mapping.table.every((entry) => inRange(entry, 0, decoded - 1) || entry === 255)) {
    return 'An Opus channel mapping table names a decoded channel the streams do not hold.';
  }
  return undefined;
}

/** The identification header's packet. */
export function encodeOpusHead(settings: OpusHeadSettings): DomainResult<Uint8Array> {
  const problem = settingsProblem(settings);
  if (problem !== undefined) return fail(unwritableStream(problem));
  const writer = new ByteWriter()
    .latin1(OPUS_HEAD)
    .u8(1)
    .u8(settings.channels)
    .u16(settings.preSkip, true)
    .u32(settings.inputRate, true)
    .u16(settings.outputGain & 0xffff, true)
    .u8(settings.mapping.family);
  if (settings.mapping.family === 1) {
    writer.u8(settings.mapping.streams).u8(settings.mapping.coupledStreams);
    for (const entry of settings.mapping.table) writer.u8(entry);
  }
  return succeed(writer.toBytes().slice());
}

/** Each configuration's frame length, in samples at 48 kHz (RFC 6716, table 2). */
const FRAME_SAMPLES: readonly number[] = Array.from({ length: 32 }, (_, config) => {
  if (config < 12) return [480, 960, 1920, 2880][config % 4] ?? 0;
  if (config < 16) return [480, 960][config % 2] ?? 0;
  return [120, 240, 480, 960][config % 4] ?? 0;
});

/** The longest an Opus packet may last: 120 ms at 48 kHz. */
const MAXIMUM_PACKET_SAMPLES = 5_760;

/** The samples at 48 kHz a packet decodes to, refusing one whose table of contents is not Opus's. */
export function opusPacketDuration(packet: Uint8Array): DomainResult<number> {
  const toc = packet[0];
  if (toc === undefined) return fail(invalidEncodedStream('An Opus packet is empty.'));
  const frameSamples = FRAME_SAMPLES[toc >> 3] ?? 0;
  const code = toc & 0x03;
  let frames: number;
  if (code === 0) {
    frames = 1;
  } else if (code !== 3) {
    frames = 2;
  } else {
    const count = packet[1];
    if (count === undefined || (count & 0x3f) === 0) {
      return fail(invalidEncodedStream('An Opus packet of code 3 states no frame count.'));
    }
    frames = count & 0x3f;
  }
  const samples = frames * frameSamples;
  return samples > MAXIMUM_PACKET_SAMPLES
    ? fail(invalidEncodedStream('An Opus packet lasts longer than 120 ms.'))
    : succeed(samples);
}
