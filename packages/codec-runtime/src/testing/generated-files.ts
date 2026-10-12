/**
 * Long files made as they are read, for a test of how the codec worker reads
 * them (ADR-0090): a chosen file whose bytes a generator writes for each slice
 * read, so a file of gibibytes is stated and never held, and a stand-in
 * `FileReaderSync` that measures every read, so a test sees how much of a file
 * the worker held at once and how much of it it read.
 *
 * Two generators: an RF64 file of 16-bit PCM whose data runs past four
 * gibibytes, with a `LIST` chunk after it, and a FLAC file of verbatim
 * subframes whose every sample is {@link flacSample} of its frame and channel,
 * each frame with the CRCs a decoder checks.
 */

import type { BlobLike, FileReaderSyncLike } from '../files/sync-file-bytes.js';

/** A file's bytes, written on demand. */
export interface GeneratedSource {
  readonly size: number;
  /** Writes the bytes at `offset` into the whole of `into`, which ends within the file. */
  fill(offset: number, into: Uint8Array): void;
}

/** What a reader read of a generated file. */
export class FileReads {
  count = 0;
  /** The bytes of the longest read, which is the most of the file held at once. */
  largest = 0;
  total = 0;
  /** The furthest byte read, plus one. */
  furthest = 0;

  record(start: number, end: number): void {
    this.count += 1;
    this.largest = Math.max(this.largest, end - start);
    this.total += end - start;
    this.furthest = Math.max(this.furthest, end);
  }
}

/** The source and range each generated file stands for. */
const SLICES = new WeakMap<
  BlobLike,
  { readonly source: GeneratedSource; readonly start: number }
>();

/** `source` as a chosen file, sliced as a `Blob` is, its bytes made only when a slice is read. */
export function generatedFile(source: GeneratedSource, start = 0, end = source.size): BlobLike {
  const file: BlobLike = {
    size: end - start,
    slice: (from, to) =>
      generatedFile(source, start + from, start + Math.min(Math.max(to, from), end - start)),
  };
  SLICES.set(file, { source, start });
  return file;
}

/** A stand-in for `FileReaderSync` over generated files, recording each read in `reads`. */
export function generatedReader(reads: FileReads): FileReaderSyncLike {
  return {
    readAsArrayBuffer: (blob) => {
      const slice = SLICES.get(blob);
      if (slice === undefined) {
        throw new DOMException('Not a generated file.', 'NotReadableError');
      }
      const bytes = new Uint8Array(blob.size);
      slice.source.fill(slice.start, bytes);
      reads.record(slice.start, slice.start + blob.size);
      return bytes.buffer;
    },
  };
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/** An RF64 file of 16-bit PCM, generated (see the module comment). */
export interface Rf64Shape {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  /** The title the `LIST` chunk after the data states. */
  readonly title: string;
}

/**
 * An RF64 file of `shape`: the form, `ds64` stating the sizes, a plain `fmt `,
 * the data, whose bytes count up from its start, then `LIST`/`INFO` with an
 * `INAM` of the title.
 */
export function rf64Source(shape: Rf64Shape): GeneratedSource {
  const blockAlign = shape.channels * 2;
  const dataBytes = shape.frames * blockAlign;
  const name = ascii(`${shape.title}\0`);
  const namePadded = name.length + (name.length % 2);
  const list = new Uint8Array(8 + 4 + 8 + namePadded);
  const listView = new DataView(list.buffer);
  list.set(ascii('LIST'), 0);
  listView.setUint32(4, list.length - 8, true);
  list.set(ascii('INFO'), 8);
  list.set(ascii('INAM'), 12);
  listView.setUint32(16, name.length, true);
  list.set(name, 20);

  const head = new Uint8Array(12 + 8 + 28 + 8 + 16 + 8);
  const view = new DataView(head.buffer);
  const size = head.length + dataBytes + (dataBytes % 2) + list.length;
  head.set(ascii('RF64'), 0);
  view.setUint32(4, 0xffffffff, true);
  head.set(ascii('WAVE'), 8);
  head.set(ascii('ds64'), 12);
  view.setUint32(16, 28, true);
  view.setBigUint64(20, BigInt(size - 8), true);
  view.setBigUint64(28, BigInt(dataBytes), true);
  view.setBigUint64(36, BigInt(shape.frames), true);
  view.setUint32(44, 0, true);
  head.set(ascii('fmt '), 48);
  view.setUint32(52, 16, true);
  view.setUint16(56, 1, true);
  view.setUint16(58, shape.channels, true);
  view.setUint32(60, shape.sampleRate, true);
  view.setUint32(64, shape.sampleRate * blockAlign, true);
  view.setUint16(68, blockAlign, true);
  view.setUint16(70, 16, true);
  head.set(ascii('data'), 72);
  view.setUint32(76, 0xffffffff, true);

  const dataStart = head.length;
  const listStart = dataStart + dataBytes + (dataBytes % 2);
  return {
    size,
    fill: (offset, into) => {
      for (let index = 0; index < into.length; index += 1) {
        const at = offset + index;
        if (at < dataStart) into[index] = head[at] ?? 0;
        else if (at < listStart) into[index] = (at - dataStart) & 0xff;
        else into[index] = list[at - listStart] ?? 0;
      }
    },
  };
}

/** A FLAC file of verbatim 16-bit subframes, generated (see the module comment). */
export interface FlacShape {
  readonly sampleRate: 44_100 | 48_000;
  /** One to eight, coded independently. */
  readonly channels: number;
  readonly frames: number;
}

/** The frames of each FLAC frame but the last. */
const FLAC_BLOCK = 4_096;

/** The 16-bit sample at `frame` of `channel`: a ramp that differs by channel and wraps. */
export function flacSample(frame: number, channel: number): number {
  return ((((frame * 37 + channel * 9_973) % 65_536) + 65_536) % 65_536) - 32_768;
}

function crcTable(polynomial: number, bits: 8 | 16): Uint16Array {
  const top = 1 << (bits - 1);
  const mask = (1 << bits) - 1;
  return Uint16Array.from({ length: 256 }, (_, byte) => {
    let crc = byte << (bits - 8);
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc & top ? (crc << 1) ^ polynomial : crc << 1) & mask;
    return crc;
  });
}

const CRC8 = crcTable(0x07, 8);
const CRC16 = crcTable(0x8005, 16);

function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = CRC8[crc ^ byte] ?? 0;
  return crc;
}

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) & 0xffff) ^ (CRC16[(crc >> 8) ^ byte] ?? 0);
  return crc;
}

/** A frame number as FLAC codes it, in UTF-8's form. */
function codedNumber(value: number): number[] {
  if (value < 0x80) return [value];
  if (value < 0x800) return [0xc0 | (value >> 6), 0x80 | (value & 0x3f)];
  return [0xe0 | (value >> 12), 0x80 | ((value >> 6) & 0x3f), 0x80 | (value & 0x3f)];
}

/** The header of frame `index`, of `frames` frames, through its CRC-8. */
function frameHeader(shape: FlacShape, index: number, frames: number): Uint8Array {
  const whole = frames === FLAC_BLOCK;
  const rateCode = shape.sampleRate === 48_000 ? 0x0a : 0x09;
  const bytes = [
    0xff,
    0xf8,
    ((whole ? 0x0c : 0x07) << 4) | rateCode,
    ((shape.channels - 1) << 4) | (0x04 << 1),
    ...codedNumber(index),
    ...(whole ? [] : [(frames - 1) >> 8, (frames - 1) & 0xff]),
  ];
  const header = new Uint8Array(bytes.length + 1);
  header.set(bytes);
  header[bytes.length] = crc8(header.subarray(0, bytes.length));
  return header;
}

/** `fLaC` and the last metadata block, STREAMINFO. */
function flacHead(shape: FlacShape): Uint8Array {
  const head = new Uint8Array(4 + 4 + 34);
  const view = new DataView(head.buffer);
  head.set(ascii('fLaC'), 0);
  view.setUint32(4, 0x80000000 | 34);
  view.setUint16(8, FLAC_BLOCK);
  view.setUint16(10, FLAC_BLOCK);
  const packed =
    (BigInt(shape.sampleRate) << 44n) |
    (BigInt(shape.channels - 1) << 41n) |
    (15n << 36n) |
    BigInt(shape.frames);
  view.setBigUint64(18, packed);
  return head;
}

/** A FLAC file of `shape`, generated (see the module comment). */
export function flacSource(shape: FlacShape): GeneratedSource {
  const head = flacHead(shape);
  const count = Math.ceil(shape.frames / FLAC_BLOCK);
  const framesOf = (index: number): number =>
    Math.min(FLAC_BLOCK, shape.frames - index * FLAC_BLOCK);
  const lengthOf = (index: number): number =>
    frameHeader(shape, index, framesOf(index)).length +
    shape.channels * (1 + 2 * framesOf(index)) +
    2;
  const starts = new Float64Array(count + 1);
  starts[0] = head.length;
  for (let index = 0; index < count; index += 1) {
    starts[index + 1] = (starts[index] ?? 0) + lengthOf(index);
  }
  let made: { readonly index: number; readonly bytes: Uint8Array } | undefined;
  const frameBytes = (index: number): Uint8Array => {
    if (made?.index === index) return made.bytes;
    const frames = framesOf(index);
    const header = frameHeader(shape, index, frames);
    const bytes = new Uint8Array(lengthOf(index));
    bytes.set(header);
    let at = header.length;
    for (let channel = 0; channel < shape.channels; channel += 1) {
      bytes[at] = 0x02;
      at += 1;
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = flacSample(index * FLAC_BLOCK + frame, channel) & 0xffff;
        bytes[at] = sample >> 8;
        bytes[at + 1] = sample & 0xff;
        at += 2;
      }
    }
    const crc = crc16(bytes.subarray(0, at));
    bytes[at] = crc >> 8;
    bytes[at + 1] = crc & 0xff;
    made = { index, bytes };
    return bytes;
  };
  const frameAt = (offset: number): number => {
    let low = 0;
    let high = count - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  return {
    size: starts[count] ?? head.length,
    fill: (offset, into) => {
      let written = 0;
      while (written < into.length) {
        const at = offset + written;
        if (at < head.length) {
          const part = head.subarray(at, Math.min(head.length, at + into.length - written));
          into.set(part, written);
          written += part.length;
          continue;
        }
        const index = frameAt(at);
        const bytes = frameBytes(index);
        const within = at - (starts[index] ?? 0);
        const part = bytes.subarray(within, Math.min(bytes.length, within + into.length - written));
        into.set(part, written);
        written += part.length;
      }
    },
  };
}
