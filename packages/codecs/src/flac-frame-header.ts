/**
 * The header of one FLAC frame (RFC 9639, section 9.1), read to learn how many
 * samples the frame holds and to check that it is the frame of the stream the
 * writer states.
 *
 * The header is checked by its own CRC-8 (polynomial 0x07, from zero), so a
 * frame cut or damaged on its way from the encoder is refused rather than
 * written into a file no decoder reads. A field stated in the header rather
 * than deferred to the stream information must agree with the stream's
 * settings.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { invalidEncodedStream } from './framing-failures.js';

/** What the writer knows of its stream, which a frame's header must agree with. */
export interface FlacStreamFormat {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
}

/** A frame's header as read. */
export interface FlacFrameHeader {
  readonly blockSize: number;

  /** Whether the frame is numbered by its frame (fixed block size) rather than by its first sample. */
  readonly fixedBlockSize: boolean;

  /** The frame's number, or its first sample's where the block size varies. */
  readonly number: number;
}

/** Each sample rate code's rate, where the code states one (codes 1 to 11). */
const RATES: readonly (number | undefined)[] = [
  undefined,
  88_200,
  176_400,
  192_000,
  8_000,
  16_000,
  22_050,
  24_000,
  32_000,
  44_100,
  48_000,
  96_000,
];

/** Each bit depth code's depth, where the code states one. */
const DEPTHS: readonly (number | undefined)[] = [undefined, 8, 12, undefined, 16, 20, 24, 32];

const CRC8_TABLE: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) {
    let remainder = index;
    for (let bit = 0; bit < 8; bit += 1) {
      remainder = remainder & 0x80 ? ((remainder << 1) ^ 0x07) & 0xff : (remainder << 1) & 0xff;
    }
    table[index] = remainder;
  }
  return table;
})();

function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = CRC8_TABLE[crc ^ byte] ?? 0;
  return crc;
}

const invalid = (problem: string) => fail(invalidEncodedStream(problem));

/** The header of the frame `frame` begins with, checked against the stream's format. */
export function readFlacFrameHeader(
  frame: Uint8Array,
  format: FlacStreamFormat,
): DomainResult<FlacFrameHeader> {
  const byte = (at: number): number | undefined => frame[at];
  if (byte(0) !== 0xff || ((byte(1) ?? 0) & 0xfe) !== 0xf8) {
    return invalid('A FLAC frame does not begin with its sync code.');
  }
  const fixedBlockSize = ((byte(1) ?? 0) & 0x01) === 0;
  const sizeCode = (byte(2) ?? 0) >> 4;
  const rateCode = (byte(2) ?? 0) & 0x0f;
  const channelCode = (byte(3) ?? 0) >> 4;
  const depthCode = ((byte(3) ?? 0) >> 1) & 0x07;
  if (
    frame.length < 6 ||
    sizeCode === 0 ||
    rateCode === 15 ||
    channelCode > 10 ||
    depthCode === 3 ||
    ((byte(3) ?? 0) & 1) !== 0
  ) {
    return invalid('A FLAC frame header holds a reserved or invalid value.');
  }

  // The frame or sample number, coded as UTF-8 codes its characters, up to 36 bits.
  let at = 4;
  const lead = byte(at) ?? 0xff;
  let extra = 0;
  while (extra < 8 && (lead & (0x80 >> extra)) !== 0) extra += 1;
  // A frame number takes at most 31 bits, six bytes; a sample number 36 bits, seven.
  if (extra === 1 || extra > (fixedBlockSize ? 6 : 7)) {
    return invalid('A FLAC frame header codes its number wrongly.');
  }
  const length = extra === 0 ? 1 : extra;
  let number = lead & (0xff >> (extra + 1));
  for (let index = 1; index < length; index += 1) {
    const next = byte(at + index);
    if (next === undefined || (next & 0xc0) !== 0x80)
      return invalid('A FLAC frame header codes its number wrongly.');
    number = number * 64 + (next & 0x3f);
  }
  at += length;

  let blockSize: number;
  if (sizeCode === 1) blockSize = 192;
  else if (sizeCode <= 5) blockSize = 144 * 2 ** sizeCode;
  else if (sizeCode === 6) {
    blockSize = (byte(at) ?? 0) + 1;
    at += 1;
  } else if (sizeCode === 7) {
    blockSize = (((byte(at) ?? 0) << 8) | (byte(at + 1) ?? 0)) + 1;
    at += 2;
  } else blockSize = 2 ** sizeCode;

  let rate = RATES[rateCode];
  if (rateCode === 12) {
    rate = (byte(at) ?? 0) * 1_000;
    at += 1;
  } else if (rateCode === 13 || rateCode === 14) {
    rate = (((byte(at) ?? 0) << 8) | (byte(at + 1) ?? 0)) * (rateCode === 13 ? 1 : 10);
    at += 2;
  }
  if (at >= frame.length) return invalid('A FLAC frame is shorter than its header.');
  if (crc8(frame.subarray(0, at)) !== byte(at)) {
    return invalid("A FLAC frame header's checksum disagrees with it.");
  }
  const channels = channelCode < 8 ? channelCode + 1 : 2;
  const depth = DEPTHS[depthCode];
  if (
    channels !== format.channels ||
    (rate !== undefined && rate !== format.sampleRate) ||
    (depth !== undefined && depth !== format.bitsPerSample)
  ) {
    return invalid("A FLAC frame states a format other than the stream's.");
  }
  return succeed({ blockSize, fixedBlockSize, number });
}
