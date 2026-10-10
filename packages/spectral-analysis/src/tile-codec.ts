/**
 * The disposable cache format of a spectrogram tile (ADR-0080).
 *
 * The bytes are a header, the levels and a checksum:
 *
 * - `AGST`, the format version (16 bits), the window's code and the overlap
 *   (8 bits each), the window's length (32 bits), the channel and the level
 *   (16 bits each), the index (a 64-bit float, exact below 2^53), the columns
 *   and the bins (16 bits each), then the source's identity and revision,
 *   each as a 16-bit count of UTF-16 code units and the units, padded to four
 *   bytes;
 * - the tile's levels, `bins` rows of `columns` bytes, padded to four bytes;
 * - the CRC-32 of everything before it.
 *
 * Numbers are little-endian. The levels are decoded as a view onto the bytes,
 * never copied. A tile of another format version, key or shape, or one whose
 * checksum does not match, is refused, and analysed again: losing a tile only
 * costs the time to make it again.
 */

import { StftWindow } from '@audiogubbins/audio-engine';
import {
  FailureKind,
  crc32,
  fail,
  failure,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';

import type { SpectralTile, SpectralTileKey } from './spectral-tile.js';

/** The version of the format this build writes and reads. */
const TILE_CACHE_FORMAT = 1;

const MAGIC = [0x41, 0x47, 0x53, 0x54] as const;
const FIXED_HEADER = 28;

/** The longest identity or revision a tile names, in UTF-16 code units. */
const MAXIMUM_TEXT = 1024;

/** Each window's code in the format. */
const WINDOW_CODES: Readonly<Record<StftWindow, number>> = {
  [StftWindow.Hann]: 0,
  [StftWindow.BlackmanHarris]: 1,
};

function padded(length: number): number {
  return Math.ceil(length / 4) * 4;
}

function textLength(text: string): number {
  return 2 + text.length * 2;
}

function headerLength(key: SpectralTileKey): number {
  return padded(FIXED_HEADER + textLength(key.identity) + textLength(key.revision));
}

/** The bytes of a tile, its key and its checksum. */
export function encodeTile(tile: SpectralTile): Uint8Array<ArrayBuffer> {
  const { key } = tile;
  if (key.identity.length > MAXIMUM_TEXT || key.revision.length > MAXIMUM_TEXT) {
    throw new RangeError('A source identity or revision is longer than a tile names.');
  }
  const start = headerLength(key);
  const size = start + padded(tile.values.length) + 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  view.setUint16(4, TILE_CACHE_FORMAT, true);
  view.setUint8(6, WINDOW_CODES[key.config.window]);
  view.setUint8(7, key.config.overlap);
  view.setUint32(8, key.config.windowLength, true);
  view.setUint16(12, key.channel, true);
  view.setUint16(14, key.level, true);
  view.setFloat64(16, key.index, true);
  view.setUint16(24, tile.columns, true);
  view.setUint16(26, tile.bins, true);
  let at = FIXED_HEADER;
  for (const text of [key.identity, key.revision]) {
    view.setUint16(at, text.length, true);
    for (let unit = 0; unit < text.length; unit += 1) {
      view.setUint16(at + 2 + unit * 2, text.charCodeAt(unit), true);
    }
    at += textLength(text);
  }
  bytes.set(tile.values, start);
  view.setUint32(size - 4, crc32(bytes.subarray(0, size - 4)), true);
  return bytes;
}

function refused(reason: string): DomainResult<never> {
  return fail(failure('spectral.tile-refused', FailureKind.Rejected, reason));
}

function textAt(view: DataView, at: number): string | undefined {
  if (at + 2 > view.byteLength) return undefined;
  const units = view.getUint16(at, true);
  if (at + 2 + units * 2 > view.byteLength) return undefined;
  const codes: number[] = [];
  for (let unit = 0; unit < units; unit += 1) codes.push(view.getUint16(at + 2 + unit * 2, true));
  return String.fromCharCode(...codes);
}

/** What a tile's bytes must hold: its key and its shape. */
export interface ExpectedTile {
  readonly key: SpectralTileKey;
  readonly columns: number;
  readonly bins: number;
}

function headerProblem(view: DataView, expected: ExpectedTile): string | undefined {
  if (view.byteLength < FIXED_HEADER + 4) return 'The tile is shorter than its header.';
  if (MAGIC.some((byte, index) => view.getUint8(index) !== byte))
    return 'The bytes are not a spectrogram tile.';
  if (view.getUint16(4, true) !== TILE_CACHE_FORMAT)
    return 'The tile is of another format version.';
  const { key } = expected;
  if (
    view.getUint8(6) !== WINDOW_CODES[key.config.window] ||
    view.getUint8(7) !== key.config.overlap ||
    view.getUint32(8, true) !== key.config.windowLength
  ) {
    return 'The tile was made with other settings.';
  }
  if (
    view.getUint16(12, true) !== key.channel ||
    view.getUint16(14, true) !== key.level ||
    view.getFloat64(16, true) !== key.index
  ) {
    return 'The tile is of another channel, level or place.';
  }
  if (view.getUint16(24, true) !== expected.columns || view.getUint16(26, true) !== expected.bins)
    return 'The tile has another shape.';
  const identity = textAt(view, FIXED_HEADER);
  const revision =
    identity === undefined ? undefined : textAt(view, FIXED_HEADER + textLength(identity));
  if (identity !== key.identity || revision !== key.revision) {
    return 'The tile was made from another source or revision.';
  }
  return undefined;
}

/**
 * The tile in `bytes`, its levels a view onto them, or why it is refused. The
 * checksum is checked when `verify` is set, which the worker does before a
 * cached tile is used; the page decodes bytes the worker has already checked
 * or just made.
 */
export function decodeTile(
  bytes: Uint8Array<ArrayBuffer>,
  expected: ExpectedTile,
  verify: boolean,
): DomainResult<SpectralTile> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const problem = headerProblem(view, expected);
  if (problem !== undefined) return refused(problem);
  const start = headerLength(expected.key);
  const cells = expected.columns * expected.bins;
  const size = start + padded(cells) + 4;
  if (bytes.byteLength !== size) return refused('The tile is torn or overlong.');
  if (verify && crc32(bytes.subarray(0, size - 4)) !== view.getUint32(size - 4, true)) {
    return refused('The tile does not match its checksum.');
  }
  return succeed({
    key: expected.key,
    columns: expected.columns,
    bins: expected.bins,
    values: new Uint8Array(bytes.buffer, bytes.byteOffset + start, cells),
  });
}
