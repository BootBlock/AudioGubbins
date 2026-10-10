/**
 * A tile and the key that names it (ADR-0080).
 *
 * A `SpectralTileKey` names the source's identity, the edited sound's
 * revision, the channel, the settings, the level and the index, so a tile of
 * an older revision is never taken for the current one; the host still draws
 * one, marked stale, until the current revision's replaces it. A tile is a
 * value: its bytes are never changed once made, so the same key always names
 * the same bytes, which is what lets a renderer keep a field by its key.
 */

import { configText, type SpectrogramConfig } from './spectrogram-config.js';

/** What a tile is of. */
export interface SpectralTileKey {
  /** The source, stable across sessions: the cache is kept under it. */
  readonly identity: string;
  /** The edited sound's revision, which every edit and change of quality changes. */
  readonly revision: string;
  readonly channel: number;
  readonly config: SpectrogramConfig;
  readonly level: number;
  readonly index: number;
}

/**
 * A tile's levels: `bins` rows of `columns` bytes, row by row, row 0 the bin at
 * 0 Hz, so the byte of `bin` and `column` is `values[bin * columns + column]`,
 * as a renderer's scalar field holds its cells.
 */
export interface SpectralTile {
  readonly key: SpectralTileKey;
  readonly columns: number;
  readonly bins: number;
  readonly values: Uint8Array<ArrayBuffer>;
}

/** Where a tile lies in a sound's spectrogram, whatever its revision. */
export function tilePlace(key: Omit<SpectralTileKey, 'revision'>): string {
  return [
    key.identity,
    configText(key.config),
    String(key.channel),
    String(key.level),
    String(key.index),
  ].join('\u0000');
}

/** The key as one piece of text, the same for equal keys: a field's key for the renderer. */
export function tileKeyText(key: SpectralTileKey): string {
  return `${tilePlace(key)}\u0000${key.revision}`;
}
