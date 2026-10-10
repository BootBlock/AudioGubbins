/**
 * The four-byte header of an MPEG audio Layer III frame (ISO/IEC 11172-3 and
 * 13818-3, with the MPEG 2.5 extension), which every MP3 frame begins with.
 *
 * The MP3 writer reads each frame LAME answers through it, to find where the
 * frame ends, how many samples it holds and where its side information ends,
 * and writes its own information frame from the first frame's header. Only
 * Layer III at a stated bit rate is MP3 as LAME writes it; any other header is
 * refused.
 */

import { ByteWriter } from './byte-writer.js';

/** The MPEG version a header names: 1, 2, or 2.5 (written 25). */
export type MpegVersion = 1 | 2 | 25;

/** A Layer III frame's header. */
export interface MpegAudioHeader {
  readonly version: MpegVersion;
  readonly bitrateIndex: number;
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly padding: boolean;
  readonly protectedByCrc: boolean;

  /** The channel mode: 0 stereo, 1 joint stereo, 2 dual channel, 3 mono. */
  readonly channelMode: number;

  /** The four header bytes, for a frame that copies them. */
  readonly bytes: Uint8Array;

  /** The frame's whole length in bytes, header included. */
  readonly frameBytes: number;

  /** The samples the frame decodes to. */
  readonly samples: number;

  /** Where the side information ends, from the frame's start: where an information frame's tag begins. */
  readonly sideInfoEnd: number;
}

/** Layer III bit rates in kbit/s by index, for MPEG 1 and for MPEG 2 and 2.5. */
const BITRATES_1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

const RATES: Readonly<Record<MpegVersion, readonly number[]>> = {
  1: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  25: [11_025, 12_000, 8_000],
};

const VERSION_BITS: readonly (MpegVersion | undefined)[] = [25, undefined, 2, 1];

/** The header `bytes` begins with, or `undefined` where it is not a Layer III frame's at a stated rate. */
export function readMpegAudioHeader(bytes: Uint8Array): MpegAudioHeader | undefined {
  const [first, second, third, fourth] = bytes;
  if (first !== 0xff || second === undefined || third === undefined || fourth === undefined)
    return undefined;
  if ((second & 0xe0) !== 0xe0 || ((second >> 1) & 0x03) !== 0x01) return undefined;
  const version = VERSION_BITS[(second >> 3) & 0x03];
  const bitrateIndex = third >> 4;
  const rateIndex = (third >> 2) & 0x03;
  if (
    version === undefined ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    rateIndex === 3 ||
    (fourth & 0x03) === 2
  ) {
    return undefined;
  }
  const bitrate = ((version === 1 ? BITRATES_1 : BITRATES_2)[bitrateIndex] ?? 0) * 1_000;
  const sampleRate = RATES[version][rateIndex] ?? 0;
  const padding = ((third >> 1) & 0x01) === 1;
  const channelMode = fourth >> 6;
  const protectedByCrc = (second & 0x01) === 0;
  const coefficient = version === 1 ? 144 : 72;
  const mono = channelMode === 3;
  const sideInfo = version === 1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  return {
    version,
    bitrateIndex,
    bitrate,
    sampleRate,
    padding,
    protectedByCrc,
    channelMode,
    bytes: bytes.subarray(0, 4),
    frameBytes: Math.floor((coefficient * bitrate) / sampleRate) + (padding ? 1 : 0),
    samples: version === 1 ? 1_152 : 576,
    sideInfoEnd: 4 + (protectedByCrc ? 2 : 0) + sideInfo,
  };
}

/**
 * The header of a frame like `model` at another bit rate index, with no CRC
 * and no padding, as an information frame takes it.
 */
export function headerAtBitrate(
  model: MpegAudioHeader,
  bitrateIndex: number,
): MpegAudioHeader | undefined {
  const [, second = 0, third = 0, fourth = 0] = model.bytes;
  return readMpegAudioHeader(
    new ByteWriter()
      .u8(0xff)
      .u8(second | 0x01)
      .u8((bitrateIndex << 4) | (third & 0x0c))
      .u8(fourth)
      .toBytes(),
  );
}
