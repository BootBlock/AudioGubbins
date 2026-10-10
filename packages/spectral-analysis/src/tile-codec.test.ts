/**
 * The tile cache format: a tile read back as it was written, its levels a view
 * onto the bytes, and every tile of another key, shape or format, or one that
 * does not match its checksum, refused with the reason.
 */

import { crc32 as zlibCrc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { StftWindow } from '@audiogubbins/audio-engine';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import type { SpectralTile, SpectralTileKey } from './spectral-tile.js';
import { decodeTile, encodeTile, type ExpectedTile } from './tile-codec.js';

const KEY: SpectralTileKey = {
  identity: 'asset-7 · “take two”',
  revision: 'r42',
  channel: 3,
  config: { windowLength: 256, window: StftWindow.BlackmanHarris, overlap: 4 },
  level: 5,
  index: 2 ** 40 + 3,
};

function tile(columns = 7, key = KEY): SpectralTile {
  const bins = 129;
  return {
    key,
    columns,
    bins,
    values: Uint8Array.from({ length: columns * bins }, (_, cell) => (cell * 37) % 256),
  };
}

const EXPECTED: ExpectedTile = { key: KEY, columns: 7, bins: 129 };

describe('the tile cache format', () => {
  it('reads a tile back as it was written, its levels a view onto the bytes', () => {
    const bytes = encodeTile(tile());
    const read = expectSuccess(decodeTile(bytes, EXPECTED, true));
    expect(read.key).toBe(KEY);
    expect([...read.values]).toEqual([...tile().values]);
    expect(read.values.buffer).toBe(bytes.buffer);
    expect(bytes.byteLength % 4).toBe(0);
  });

  it('ends with the CRC-32 of everything before it', () => {
    const bytes = encodeTile(tile());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(bytes.byteLength - 4, true)).toBe(zlibCrc32(bytes.subarray(0, -4)));
  });

  it('reads a tile from bytes that start partway into their buffer', () => {
    const bytes = encodeTile(tile());
    const within = new Uint8Array(bytes.byteLength + 3);
    within.set(bytes, 3);
    const read = expectSuccess(decodeTile(within.subarray(3), EXPECTED, true));
    expect([...read.values]).toEqual([...tile().values]);
  });

  it.each<[string, ExpectedTile, RegExp]>([
    ['of another revision', { ...EXPECTED, key: { ...KEY, revision: 'r43' } }, /revision/u],
    ['of another source', { ...EXPECTED, key: { ...KEY, identity: 'asset-8' } }, /source/u],
    [
      'made with another window',
      { ...EXPECTED, key: { ...KEY, config: { ...KEY.config, window: StftWindow.Hann } } },
      /settings/u,
    ],
    [
      'made with another overlap',
      { ...EXPECTED, key: { ...KEY, config: { ...KEY.config, overlap: 8 } } },
      /settings/u,
    ],
    [
      'made with another window length',
      { ...EXPECTED, key: { ...KEY, config: { ...KEY.config, windowLength: 512 } } },
      /settings/u,
    ],
    ['of another channel', { ...EXPECTED, key: { ...KEY, channel: 2 } }, /channel/u],
    ['of another level', { ...EXPECTED, key: { ...KEY, level: 4 } }, /level/u],
    ['of another place', { ...EXPECTED, key: { ...KEY, index: 2 ** 40 + 2 } }, /place/u],
    ['of another width', { ...EXPECTED, columns: 8 }, /shape/u],
    ['of another height', { ...EXPECTED, bins: 257 }, /shape/u],
  ])('refuses a tile %s', (_case, expected, reason) => {
    const refused = decodeTile(encodeTile(tile()), expected, true);
    expect(expectFailureCode(refused)).toBe('spectral.tile-refused');
    expect(refused.ok ? '' : refused.failures[0].summary).toMatch(reason);
  });

  it('refuses a tile whose levels do not match its checksum, unless asked not to check', () => {
    const bytes = encodeTile(tile());
    bytes[bytes.byteLength - 20]! ^= 0x10;
    const refused = decodeTile(bytes, EXPECTED, true);
    expect(refused.ok ? '' : refused.failures[0].summary).toMatch(/checksum/u);
    expect(decodeTile(bytes, EXPECTED, false).ok).toBe(true);
  });

  it('refuses bytes torn short, overlong, of another format version, or not a tile at all', () => {
    const bytes = encodeTile(tile());
    const reasons = [
      bytes.slice(0, -8),
      Uint8Array.from([...bytes, 0, 0, 0, 0]),
      Uint8Array.from(bytes, (byte, at) => (at === 4 ? 2 : byte)),
      Uint8Array.from(bytes, (byte, at) => (at === 0 ? 0x50 : byte)),
      new Uint8Array(12),
    ].map((wrong) => {
      const refused = decodeTile(wrong, EXPECTED, true);
      return refused.ok ? 'read' : refused.failures[0].summary;
    });
    expect(reasons).toEqual([
      'The tile is torn or overlong.',
      'The tile is torn or overlong.',
      'The tile is of another format version.',
      'The bytes are not a spectrogram tile.',
      'The tile is shorter than its header.',
    ]);
  });

  it('refuses to name a source or revision longer than a tile holds', () => {
    expect(() => encodeTile(tile(7, { ...KEY, revision: 'r'.repeat(1025) }))).toThrow(RangeError);
  });
});
