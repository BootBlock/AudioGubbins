/**
 * The information frame that opens an MP3 stream: the Xing header, `Info` for
 * a constant bit rate and `Xing` otherwise, with LAME's extension.
 *
 * It is a silent Layer III frame of the stream's own version, rate and channel
 * mode whose side information is followed by the frame count, the byte count
 * and a table of contents of a hundred byte positions, by which a player knows
 * the length and seeks without reading the stream, then LAME's tag: the
 * encoder's name, the bit rate, the encoder's delay and padding, by which a
 * player trims the priming and the padding for gapless playback, the music's
 * length and checksum, and the tag's own checksum. A constant bit rate stream
 * takes its own bit rate for the frame where it fits, so a player that reckons
 * the length from the frame size alone reckons it right.
 *
 * The counts are of the audio frames after this one; the byte count and the
 * positions include this frame, from its first byte.
 */

import { ByteWriter } from './byte-writer.js';
import { headerAtBitrate, type MpegAudioHeader } from './mpeg-audio-header.js';

/** The CRC-16 LAME's tag uses: polynomial 0x8005 reflected, from zero (CRC-16/ARC). */
const CRC16_TABLE: Uint16Array = (() => {
  const table = new Uint16Array(256);
  for (let index = 0; index < 256; index += 1) {
    let remainder = index;
    for (let bit = 0; bit < 8; bit += 1)
      remainder = remainder & 1 ? (remainder >>> 1) ^ 0xa001 : remainder >>> 1;
    table[index] = remainder;
  }
  return table;
})();

/** The CRC-16 of `bytes`, continuing from `crc`. */
export function lameCrc(bytes: Uint8Array, crc = 0): number {
  let remainder = crc;
  for (const byte of bytes)
    remainder = (remainder >>> 8) ^ (CRC16_TABLE[(remainder ^ byte) & 0xff] ?? 0);
  return remainder;
}

/** The Xing fields present: frames, bytes, table of contents and quality. */
const ALL_XING_FIELDS = 0x0f;

/** The Xing fields and LAME's tag. */
const TAG_BYTES = 4 + 4 + 4 + 4 + 100 + 4 + 36;

/** What an information frame states. */
export interface InfoFrameContents {
  /** The first audio frame's header, whose version, rate and mode the frame takes. */
  readonly model: MpegAudioHeader;

  /** Whether every audio frame has the model's bit rate. */
  readonly constantBitrate: boolean;
  readonly audioFrames: number;
  readonly audioBytes: number;

  /** The offset of an audio frame from the first audio frame's first byte. */
  readonly audioOffset: (frame: number) => number;

  /** LAME's name and version, at most nine ASCII characters, as `LAME3.100`. */
  readonly encoder: string;
  readonly delay: number;
  readonly padding: number;

  /** The CRC-16 of the audio frames' bytes. */
  readonly musicCrc: number;
}

/** The smallest frame of the model's version, rate and mode that holds the tag, preferring the model's own rate. */
function frameHeader(contents: InfoFrameContents): MpegAudioHeader | undefined {
  const fits = (header: MpegAudioHeader | undefined) =>
    header !== undefined && header.frameBytes >= header.sideInfoEnd + TAG_BYTES;
  const own = headerAtBitrate(contents.model, contents.model.bitrateIndex);
  if (contents.constantBitrate && fits(own)) return own;
  for (let index = 1; index < 15; index += 1) {
    const header = headerAtBitrate(contents.model, index);
    if (fits(header)) return header;
  }
  return undefined;
}

/** The information frame, or `undefined` where no frame of the stream's format holds it. */
export function encodeInfoFrame(contents: InfoFrameContents): Uint8Array | undefined {
  const header = frameHeader(contents);
  if (header === undefined) return undefined;
  const totalBytes = header.frameBytes + contents.audioBytes;
  const writer = new ByteWriter()
    .bytes(header.bytes)
    .zeros(header.sideInfoEnd - 4)
    .latin1(contents.constantBitrate ? 'Info' : 'Xing')
    .u32(ALL_XING_FIELDS)
    .u32(contents.audioFrames)
    .u32(totalBytes);
  for (let percent = 0; percent < 100; percent += 1) {
    const frame = Math.floor((percent * contents.audioFrames) / 100);
    const position = header.frameBytes + contents.audioOffset(frame);
    writer.u8(Math.min(255, Math.floor((256 * position) / totalBytes)));
  }
  // The quality, which LAME states as 100 minus ten times its VBR quality; unknown here.
  writer.u32(0);

  const encoder = contents.encoder.slice(0, 9).padEnd(9, ' ');
  const sourceRate =
    header.sampleRate <= 32_000
      ? 0
      : header.sampleRate === 44_100
        ? 1
        : header.sampleRate === 48_000
          ? 2
          : 3;
  writer
    .latin1(encoder)
    // Tag revision 0 and the bit rate method: 1, a constant bit rate, or 0, unknown.
    .u8(contents.constantBitrate ? 1 : 0)
    .u8(0)
    .zeros(4 + 2 + 2)
    .u8(0)
    .u8(contents.constantBitrate ? Math.min(255, contents.model.bitrate / 1_000) : 0)
    .u24((Math.min(contents.delay, 0xfff) << 12) | Math.min(contents.padding, 0xfff))
    .u8(sourceRate << 6)
    .u8(0)
    .u16(0)
    .u32(totalBytes)
    .u16(contents.musicCrc);
  // The tag's own checksum covers every byte of the frame before it: 190 bytes in a stereo MPEG 1 frame.
  const tagCrc = lameCrc(writer.toBytes());
  writer.u16(tagCrc);
  writer.zeros(header.frameBytes - writer.length);
  return writer.toBytes().slice();
}
