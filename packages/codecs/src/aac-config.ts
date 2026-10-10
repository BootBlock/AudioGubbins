/**
 * The AudioSpecificConfig an AAC encoder states (ISO/IEC 14496-3, 1.6.2.1),
 * and the `esds` descriptor that carries it in an MP4 sample entry
 * (ISO/IEC 14496-1, 7.2.6).
 *
 * The browser's encoder answers the configuration beside its first access
 * unit; the MP4 writer reads from it what the file must state elsewhere, the
 * object type, rate, channel configuration and frame length, and refuses one
 * that is not AAC-LC with a stated channel configuration, the only AAC this
 * application encodes (ADR-0091).
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { ByteWriter, concatenate } from './byte-writer.js';
import { invalidEncodedStream, unwritableStream } from './framing-failures.js';

/** What an AudioSpecificConfig states. */
export interface AacConfig {
  readonly objectType: number;
  readonly sampleRate: number;
  readonly channels: number;

  /** The samples one access unit decodes to: 1024, or 960 where the frame length flag is set. */
  readonly frameLength: number;
}

/** The rates the sampling frequency index names. */
const SAMPLE_RATES: readonly number[] = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
  7_350,
];

/** The channels each channel configuration holds, from 1 to 7. */
const CONFIGURATION_CHANNELS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 8];

const AAC_LC = 2;

/** Reads bits most significant first. */
class BitReader {
  private readonly bytes: Uint8Array;
  private position = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** The next `count` bits, or `undefined` past the end. */
  read(count: number): number | undefined {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = this.bytes[this.position >> 3];
      if (byte === undefined) return undefined;
      value = value * 2 + ((byte >> (7 - (this.position & 7))) & 1);
      this.position += 1;
    }
    return value;
  }
}

/** The configuration `bytes` states, refused where it is not AAC-LC with a stated channel configuration. */
export function readAacConfig(bytes: Uint8Array): DomainResult<AacConfig> {
  const bits = new BitReader(bytes);
  let objectType = bits.read(5);
  if (objectType === 31) {
    const extension = bits.read(6);
    objectType = extension === undefined ? undefined : 32 + extension;
  }
  const rateIndex = bits.read(4);
  const sampleRate = rateIndex === 15 ? bits.read(24) : SAMPLE_RATES[rateIndex ?? 15];
  const configuration = bits.read(4);
  const frameLengthFlag = bits.read(1);
  if (
    objectType === undefined ||
    sampleRate === undefined ||
    configuration === undefined ||
    frameLengthFlag === undefined
  ) {
    return fail(invalidEncodedStream('The AAC configuration is shorter than its fields.'));
  }
  if (objectType !== AAC_LC) {
    return fail(
      unwritableStream(
        `The AAC configuration names object type ${String(objectType)}, not AAC-LC.`,
      ),
    );
  }
  const channels = CONFIGURATION_CHANNELS[configuration];
  if (channels === undefined || channels === 0 || sampleRate === 0) {
    return fail(
      unwritableStream(
        'The AAC configuration states no channel configuration or rate an MP4 file can name.',
      ),
    );
  }
  return succeed({
    objectType,
    sampleRate,
    channels,
    frameLength: frameLengthFlag === 1 ? 960 : 1024,
  });
}

/** A descriptor: its tag, its body's length in the expandable form, and its body. */
function descriptor(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const body = concatenate(parts);
  const length = new ByteWriter().u8(tag);
  // The length in groups of seven bits, every byte but the last with its top bit set.
  const groups: number[] = [];
  for (let remaining = body.length; ; remaining = Math.floor(remaining / 128)) {
    groups.unshift(remaining % 128);
    if (remaining < 128) break;
  }
  groups.forEach((group, index) => length.u8(index < groups.length - 1 ? group | 0x80 : group));
  return concatenate([length.toBytes(), body]);
}

/** What the decoder configuration states of the stream's access units. */
export interface AacStreamRates {
  /** The largest access unit, in bytes. */
  readonly bufferBytes: number;
  readonly maximumBitrate: number;
  readonly averageBitrate: number;
}

/** The `esds` box's body after its version and flags: the elementary stream descriptor. */
export function elementaryStreamDescriptor(config: Uint8Array, rates: AacStreamRates): Uint8Array {
  const decoderConfig = descriptor(
    0x04,
    new ByteWriter()
      // MPEG-4 audio, an audio stream.
      .u8(0x40)
      .u8((0x05 << 2) | 1)
      .u24(Math.min(rates.bufferBytes, 0xffffff))
      .u32(Math.min(rates.maximumBitrate, 0xffffffff))
      .u32(Math.min(rates.averageBitrate, 0xffffffff))
      .toBytes(),
    descriptor(0x05, config),
  );
  // The SL configuration predefined for MP4 files.
  const slConfig = descriptor(0x06, Uint8Array.of(0x02));
  return descriptor(0x03, new ByteWriter().u16(0).u8(0).toBytes(), decoderConfig, slConfig);
}
