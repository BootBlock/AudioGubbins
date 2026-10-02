/**
 * Encoding planar samples as a file stores them, by the exact inverse of the
 * reading rule, and the chunk framing both writers share.
 *
 * Written apart from the reader's own conversion, so a fixture that round-trips
 * checks the two against each other rather than one against itself. A sample
 * that the encoding cannot hold exactly is a mistake in the test, so it throws
 * rather than rounding: an integer sample must be a whole number of steps of
 * `2^-(bits - 1)` within the encoding's range, and a 32-bit float sample must
 * already be a float32. A 32-bit float channel given as a `Float32Array` is
 * written bit for bit, so a NaN's payload reaches the file unchanged.
 */

/** How a writer stores each sample. */
export type FixtureEncoding =
  | {
      readonly kind: 'integer';
      readonly bits: number;
      readonly bytes: number;
      readonly littleEndian: boolean;
      readonly signed: boolean;
    }
  | { readonly kind: 'float'; readonly bits: 32 | 64; readonly littleEndian: boolean };

/** A channel of samples: a `Float64Array` holds any 32-bit integer sample exactly. */
export type FixtureChannel = Float32Array | Float64Array;

/** A chunk to write: `statedSize` replaces its size field, to state a size its body is not. */
export interface FixtureChunk {
  readonly id: string;
  readonly body: Uint8Array;
  readonly statedSize?: number;
}

/** The bytes of one sample in a container. */
function bytesOfSample(encoding: FixtureEncoding): number {
  return encoding.kind === 'float' ? encoding.bits / 8 : encoding.bytes;
}

/** The container integer of an integer sample, left-justified and offset where unsigned. */
function containerInteger(
  sample: number,
  encoding: Extract<FixtureEncoding, { kind: 'integer' }>,
): number {
  const code = sample * 2 ** (encoding.bits - 1);
  const limit = 2 ** (encoding.bits - 1);
  if (!Number.isInteger(code) || code < -limit || code >= limit) {
    throw new RangeError(`${String(sample)} is not a ${String(encoding.bits)}-bit sample.`);
  }
  const justified = code * 2 ** (encoding.bytes * 8 - encoding.bits);
  return encoding.signed ? justified : justified + 2 ** (encoding.bytes * 8 - 1);
}

/** Writes an integer of `bytes` bytes at `offset`, its two's complement where negative. */
function writeInteger(
  view: DataView,
  offset: number,
  value: number,
  bytes: number,
  littleEndian: boolean,
): void {
  const unsigned = value < 0 ? value + 2 ** (bytes * 8) : value;
  for (let index = 0; index < bytes; index += 1) {
    const byte = Math.floor(unsigned / 2 ** (index * 8)) % 256;
    view.setUint8(littleEndian ? offset + index : offset + bytes - 1 - index, byte);
  }
}

/** Writes one channel's sample `frame` at `offset`. */
function writeSample(
  view: DataView,
  offset: number,
  channel: FixtureChannel,
  frame: number,
  encoding: FixtureEncoding,
): void {
  const sample = channel[frame] ?? 0;
  if (encoding.kind === 'integer') {
    writeInteger(
      view,
      offset,
      containerInteger(sample, encoding),
      encoding.bytes,
      encoding.littleEndian,
    );
  } else if (encoding.bits === 64) {
    view.setFloat64(offset, sample, encoding.littleEndian);
  } else if (channel instanceof Float32Array) {
    const bits = new Uint32Array(channel.buffer, channel.byteOffset, channel.length);
    view.setUint32(offset, bits[frame] ?? 0, encoding.littleEndian);
  } else if (Math.fround(sample) === sample || Number.isNaN(sample)) {
    view.setFloat32(offset, sample, encoding.littleEndian);
  } else {
    throw new RangeError(`${String(sample)} is not a 32-bit float.`);
  }
}

/** Interleaves planar channels, each of the same length, into the bytes a file stores. */
export function encodeFrames(
  channels: readonly FixtureChannel[],
  encoding: FixtureEncoding,
): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const sampleBytes = bytesOfSample(encoding);
  const out = new Uint8Array(frames * channels.length * sampleBytes);
  const view = new DataView(out.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    for (const [index, channel] of channels.entries()) {
      writeSample(view, (frame * channels.length + index) * sampleBytes, channel, frame, encoding);
    }
  }
  return out;
}

/** Joins byte arrays in order. */
export function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The bytes of a four-character code. */
export function codeBytes(code: string): Uint8Array {
  return Uint8Array.from(code, (character) => character.charCodeAt(0));
}

/** Little- or big-endian unsigned integers of the given byte widths, in order. */
export function fields(littleEndian: boolean, ...values: readonly [number, number][]): Uint8Array {
  const out = new Uint8Array(values.reduce((total, [, bytes]) => total + bytes, 0));
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const [value, bytes] of values) {
    writeInteger(view, offset, value, bytes, littleEndian);
    offset += bytes;
  }
  return out;
}

/** A chunk as a file holds it: its id, its size, its body and a pad byte after an odd body. */
export function chunkBytes(chunk: FixtureChunk, littleEndian: boolean): Uint8Array {
  const size = chunk.statedSize ?? chunk.body.length;
  const pad = new Uint8Array(chunk.body.length % 2);
  return joinBytes([codeBytes(chunk.id), fields(littleEndian, [size, 4]), chunk.body, pad]);
}
