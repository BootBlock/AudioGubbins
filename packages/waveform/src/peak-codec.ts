/**
 * The disposable cache format of a peak pyramid (ADR-0043).
 *
 * The bytes are a header, the levels and a checksum:
 *
 * - `AGPK`, the format version (16 bits), then the sample rate (32 bits), the
 *   frames (a 64-bit float, exact below 2^53), the channels and the levels (16
 *   bits each), the frames of a level-zero bucket and the fan-out (32 bits
 *   each), then the source's identity and revision, each as a 16-bit count of
 *   UTF-16 code units and the units, padded to four bytes;
 * - for each level and each of its channels: the minima, the maxima and the
 *   root mean squares as 16-bit steps, then a byte a bucket for clipping, each
 *   padded to four bytes;
 * - the CRC-32 of everything before it.
 *
 * Numbers are little-endian. The levels are decoded as views onto the bytes,
 * never copied, which needs a little-endian machine; on another, decoding
 * refuses every cache, which is made again, rather than reading it wrongly. A
 * cache of another format version, identity, revision or shape, or one whose
 * checksum does not match, is refused the same way: losing a cache only costs
 * the time to make it again.
 */

import {
  FailureKind,
  crc32,
  fail,
  failure,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  BASE_BUCKET_FRAMES,
  LEVEL_FANOUT,
  peakGeometry,
  type PeakGeometry,
} from './peak-geometry.js';
import type { PeakChannel, PeakLevel } from './peak-pyramid.js';

/** The version of the format this build writes and reads. */
const PEAK_CACHE_FORMAT = 1;

const MAGIC = [0x41, 0x47, 0x50, 0x4b] as const;
const FIXED_HEADER = 32;

/** Whether this machine stores numbers least significant byte first. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** What a cache was made from, which a read must match. */
export interface PeakCacheIdentity {
  readonly identity: string;
  readonly revision: string;
  readonly sampleRate: number;
}

/** A decoded cache: its shape and its levels, every bucket known. */
export interface DecodedPeaks {
  readonly geometry: PeakGeometry;
  readonly levels: readonly PeakLevel[];
}

function padded(length: number): number {
  return Math.ceil(length / 4) * 4;
}

function textLength(text: string): number {
  return 2 + text.length * 2;
}

function headerLength(source: PeakCacheIdentity): number {
  return padded(FIXED_HEADER + textLength(source.identity) + textLength(source.revision));
}

/** The bytes of the levels of a pyramid of `geometry`. */
function levelsLength(geometry: PeakGeometry): number {
  return geometry.levels.reduce(
    (sum, level) =>
      sum + geometry.channels * (3 * padded(level.buckets * 2) + padded(level.buckets)),
    0,
  );
}

/** Writes 16-bit values at `at`, as a block where the machine's order is the format's. */
function writeSteps(
  bytes: Uint8Array<ArrayBuffer>,
  view: DataView,
  at: number,
  values: Int16Array,
): void {
  if (LITTLE_ENDIAN) {
    new Int16Array(bytes.buffer, at, values.length).set(values);
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    view.setInt16(at + index * 2, values[index] ?? 0, true);
  }
}

/** The longest identity or revision a cache names, in UTF-16 code units. */
const MAXIMUM_TEXT = 1024;

/** The bytes of a whole pyramid. */
export function encodePeaks(
  geometry: PeakGeometry,
  levels: readonly PeakLevel[],
  source: PeakCacheIdentity,
): Uint8Array<ArrayBuffer> {
  if (source.identity.length > MAXIMUM_TEXT || source.revision.length > MAXIMUM_TEXT) {
    throw new RangeError('A source identity or revision is longer than a cache names.');
  }
  const start = headerLength(source);
  const size = start + levelsLength(geometry) + 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  view.setUint16(4, PEAK_CACHE_FORMAT, true);
  view.setUint32(8, source.sampleRate, true);
  view.setFloat64(12, geometry.frames, true);
  view.setUint16(20, geometry.channels, true);
  view.setUint16(22, levels.length, true);
  view.setUint32(24, BASE_BUCKET_FRAMES, true);
  view.setUint32(28, LEVEL_FANOUT, true);
  let at = FIXED_HEADER;
  for (const text of [source.identity, source.revision]) {
    view.setUint16(at, text.length, true);
    for (let unit = 0; unit < text.length; unit += 1) {
      view.setUint16(at + 2 + unit * 2, text.charCodeAt(unit), true);
    }
    at += textLength(text);
  }
  at = start;
  for (const level of levels) {
    for (const channel of level.channels) {
      for (const values of [channel.minimum, channel.maximum, channel.rms]) {
        writeSteps(bytes, view, at, values);
        at += padded(values.length * 2);
      }
      bytes.set(channel.clipped, at);
      at += padded(channel.clipped.length);
    }
  }
  view.setUint32(size - 4, crc32(bytes.subarray(0, size - 4)), true);
  return bytes;
}

function refused(reason: string): DomainResult<never> {
  return fail(failure('waveform.cache-refused', FailureKind.Rejected, reason));
}

function textAt(view: DataView, at: number): string | undefined {
  if (at + 2 > view.byteLength) return undefined;
  const units = view.getUint16(at, true);
  if (at + 2 + units * 2 > view.byteLength) return undefined;
  const codes: number[] = [];
  for (let unit = 0; unit < units; unit += 1) codes.push(view.getUint16(at + 2 + unit * 2, true));
  return String.fromCharCode(...codes);
}

function headerProblem(view: DataView, expected: PeakCacheIdentity): string | undefined {
  if (view.byteLength < FIXED_HEADER + 4) return 'The cache is shorter than its header.';
  if (MAGIC.some((byte, index) => view.getUint8(index) !== byte))
    return 'The bytes are not a peak cache.';
  if (view.getUint16(4, true) !== PEAK_CACHE_FORMAT)
    return 'The cache is of another format version.';
  if (
    view.getUint32(24, true) !== BASE_BUCKET_FRAMES ||
    view.getUint32(28, true) !== LEVEL_FANOUT
  ) {
    return 'The cache has another bucket geometry.';
  }
  if (view.getUint32(8, true) !== expected.sampleRate)
    return 'The cache was made at another sample rate.';
  const identity = textAt(view, FIXED_HEADER);
  const revision =
    identity === undefined ? undefined : textAt(view, FIXED_HEADER + textLength(identity));
  if (identity !== expected.identity || revision !== expected.revision) {
    return 'The cache was made from another source or revision.';
  }
  return undefined;
}

/**
 * The pyramid in `bytes`, as views onto them, or why the cache is refused. The
 * checksum is checked when `verify` is set, which the worker does before a
 * cache is used; the page decodes bytes the worker has already checked.
 */
export function decodePeaks(
  bytes: Uint8Array<ArrayBuffer>,
  expected: PeakCacheIdentity & { readonly frames: number; readonly channels: number },
  verify: boolean,
): DomainResult<DecodedPeaks> {
  if (!LITTLE_ENDIAN) return refused('This machine is big-endian, and a cache is read as views.');
  // The levels are views of 16-bit values, which must start on an even byte.
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const view = new DataView(aligned.buffer, aligned.byteOffset, aligned.byteLength);
  const problem = headerProblem(view, expected);
  if (problem !== undefined) return refused(problem);
  const frames = view.getFloat64(12, true);
  const channels = view.getUint16(20, true);
  if (frames !== expected.frames || channels !== expected.channels) {
    return refused('The cache has another length or channel count.');
  }
  const geometry = peakGeometry(frames, channels);
  if (view.getUint16(22, true) !== geometry.levels.length)
    return refused('The cache has another number of levels.');
  const expectedSize = headerLength(expected) + levelsLength(geometry) + 4;
  if (aligned.byteLength !== expectedSize) return refused('The cache is torn or overlong.');
  if (
    verify &&
    crc32(aligned.subarray(0, expectedSize - 4)) !== view.getUint32(expectedSize - 4, true)
  ) {
    return refused('The cache does not match its checksum.');
  }
  let at = aligned.byteOffset + headerLength(expected);
  const buffer = aligned.buffer;
  const levels: PeakLevel[] = geometry.levels.map((level) => {
    const levelChannels: PeakChannel[] = [];
    for (let channel = 0; channel < channels; channel += 1) {
      const minimum = new Int16Array(buffer, at, level.buckets);
      at += padded(level.buckets * 2);
      const maximum = new Int16Array(buffer, at, level.buckets);
      at += padded(level.buckets * 2);
      const rms = new Int16Array(buffer, at, level.buckets);
      at += padded(level.buckets * 2);
      const clipped = new Uint8Array(buffer, at, level.buckets);
      at += padded(level.buckets);
      levelChannels.push({ minimum, maximum, rms, clipped });
    }
    return { ...level, channels: levelChannels, known: new Uint8Array(level.buckets).fill(1) };
  });
  return succeed({ geometry, levels });
}
