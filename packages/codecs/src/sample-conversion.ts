/**
 * The one rule by which a stored sample becomes the engine's 32-bit float.
 *
 * It gives the same bits on every machine (ADR-0032), because each step is an
 * exact integer operation or one correctly rounded IEEE-754 operation:
 *
 * - An integer sample of `bits` valid bits in `bytes` container bytes is read as
 *   an integer of the container's width in its byte order: two's complement, or
 *   offset binary with half the container's range subtracted first (WAV's
 *   eight-bit samples and AIFF-C `raw `). The padding bits below the valid ones
 *   are dropped by an arithmetic shift right of `8 × bytes − bits`. The integer
 *   is divided by `2^(bits − 1)`, exact in a double since the divisor is a power
 *   of two, and rounded to float32 by `Math.fround`: exact for 24 bits or fewer,
 *   correctly rounded for more. Full scale is therefore −1 inclusive to 1
 *   exclusive.
 * - A 32-bit float is taken as it is, its four bytes copied into the output's
 *   own, so every bit survives, a NaN's payload included.
 * - A 64-bit float is rounded to the nearest float32 by `Math.fround`.
 *
 * Nothing is resampled, dithered or clipped.
 */

import { viewOf } from './byte-reading.js';
import type { IntegerSampleEncoding, SampleEncoding } from './format-descriptor.js';

/** Reads one container integer at an offset: two's complement where `signed`. */
type ContainerReader = (view: DataView, offset: number, littleEndian: boolean) => number;

/** A three-byte integer, which `DataView` has no reader for, as unsigned. */
function unsigned24(view: DataView, offset: number, littleEndian: boolean): number {
  const first = view.getUint8(offset);
  const last = view.getUint8(offset + 2);
  const middle = view.getUint8(offset + 1) << 8;
  return littleEndian ? first | middle | (last << 16) : last | middle | (first << 16);
}

/** A three-byte two's complement integer: shifting it to the top of 32 bits and back extends its sign. */
function signed24(view: DataView, offset: number, littleEndian: boolean): number {
  return (unsigned24(view, offset, littleEndian) << 8) >> 8;
}

const READ_INT8: ContainerReader = (view, offset) => view.getInt8(offset);
const READ_UINT8: ContainerReader = (view, offset) => view.getUint8(offset);
const READ_INT16: ContainerReader = (view, offset, littleEndian) =>
  view.getInt16(offset, littleEndian);
const READ_UINT16: ContainerReader = (view, offset, littleEndian) =>
  view.getUint16(offset, littleEndian);
const READ_INT32: ContainerReader = (view, offset, littleEndian) =>
  view.getInt32(offset, littleEndian);
const READ_UINT32: ContainerReader = (view, offset, littleEndian) =>
  view.getUint32(offset, littleEndian);

/** The reader of a container of `bytes` bytes, which the encoding has bounded to 1 to 4. */
function containerReader(bytes: number, signed: boolean): ContainerReader {
  switch (bytes) {
    case 1:
      return signed ? READ_INT8 : READ_UINT8;
    case 2:
      return signed ? READ_INT16 : READ_UINT16;
    case 3:
      return signed ? signed24 : unsigned24;
    default:
      return signed ? READ_INT32 : READ_UINT32;
  }
}

/** Converts one integer sample at an offset to its float. */
function integerSampleReader(
  encoding: IntegerSampleEncoding,
): (view: DataView, offset: number) => number {
  const littleEndian = encoding.byteOrder === 'little';
  const padding = encoding.bytes * 8 - encoding.bits;
  const scale = 2 ** (encoding.bits - 1);
  const read = containerReader(encoding.bytes, encoding.signed);
  // Offset binary is centred on half its range. The centred value fits a signed
  // 32-bit integer, so the shift below is the arithmetic one either way.
  const bias = encoding.signed ? 0 : 2 ** (encoding.bytes * 8 - 1);
  return (view, offset) =>
    Math.fround(((read(view, offset, littleEndian) - bias) >> padding) / scale);
}

/** Writes `frames` samples of one channel, the first at `first` bytes and each `stride` after. */
type ChannelDecoder = (
  view: DataView,
  first: number,
  stride: number,
  frames: number,
  target: Float32Array,
  at: number,
) => void;

/** The decoder of one channel's samples in this encoding. */
function channelDecoder(encoding: SampleEncoding): ChannelDecoder {
  const littleEndian = encoding.byteOrder === 'little';
  if (encoding.kind === 'float' && encoding.bits === 32) {
    return (view, first, stride, frames, target, at) => {
      // A float32 carried through a number may lose a NaN's payload, so the bits
      // are moved as an integer, through a view of the output's own memory.
      const bits = new Uint32Array(target.buffer, target.byteOffset, target.length);
      for (let frame = 0; frame < frames; frame += 1) {
        bits[at + frame] = view.getUint32(first + frame * stride, littleEndian);
      }
    };
  }
  const sampleAt =
    encoding.kind === 'float'
      ? (view: DataView, offset: number) => Math.fround(view.getFloat64(offset, littleEndian))
      : integerSampleReader(encoding);
  return (view, first, stride, frames, target, at) => {
    for (let frame = 0; frame < frames; frame += 1) {
      target[at + frame] = sampleAt(view, first + frame * stride);
    }
  };
}

/**
 * Converts `frames` interleaved frames from `bytes` into planar `into`, one
 * array per channel, writing from index `at`.
 */
export function decodeFrames(
  encoding: SampleEncoding,
  bytes: Uint8Array,
  frames: number,
  into: readonly Float32Array[],
  at: number,
): void {
  const view = viewOf(bytes);
  const decode = channelDecoder(encoding);
  const stride = into.length * encoding.bytes;
  for (const [channel, target] of into.entries()) {
    decode(view, channel * encoding.bytes, stride, frames, target, at);
  }
}
