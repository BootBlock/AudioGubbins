/**
 * The tiles the page holds, within a stated budget (ADR-0080).
 *
 * One tile is held for each place in a sound's spectrogram, of whichever
 * revision arrived last, so while a new revision's tiles are made the old
 * ones are still drawn, marked stale, and an edit never empties the view; the
 * new tile replaces the old where it lies. Past the budget the tile drawn
 * least recently goes first, never one a view shows now: those are what the
 * views draw, and dropping one would only have it made again.
 */

import { tilePlace, type SpectralTile } from './spectral-tile.js';

/**
 * The bytes of tiles the page holds before it lets one go: some 250 tiles of
 * the default settings, a screenful of every channel of a surround sound at
 * several zooms, or fifteen at the longest window.
 */
export const TILE_MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;

/** Tiles by place, the least recently shown first. */
export class TileMemory {
  readonly #budget: number;
  /** In order of use, the least recent first: a tile shown is moved to the end. */
  readonly #held = new Map<string, SpectralTile>();
  #bytes = 0;

  constructor(budget: number) {
    this.#budget = budget;
  }

  /** The bytes held now. */
  get bytes(): number {
    return this.#bytes;
  }

  /** The tile held at `place`, of whichever revision. */
  at(place: string): SpectralTile | undefined {
    return this.#held.get(place);
  }

  /** Marks the tile at `place` as shown now, the last to go. */
  shown(place: string): void {
    const tile = this.#held.get(place);
    if (tile === undefined) return;
    this.#held.delete(place);
    this.#held.set(place, tile);
  }

  /**
   * Holds `tile` in place of any other at its place, then lets the least
   * recently shown go until the budget holds them, skipping those `inView`
   * says a view shows.
   */
  hold(tile: SpectralTile, inView: (place: string) => boolean): void {
    const place = tilePlace(tile.key);
    this.#forget(place);
    this.#held.set(place, tile);
    this.#bytes += sizeOf(tile);
    for (const [held, kept] of this.#held) {
      if (this.#bytes <= this.#budget) break;
      if (held !== place && !inView(held)) {
        this.#held.delete(held);
        this.#bytes -= sizeOf(kept);
      }
    }
  }

  #forget(place: string): void {
    const held = this.#held.get(place);
    if (held === undefined) return;
    this.#held.delete(place);
    this.#bytes -= sizeOf(held);
  }
}

/** What a tile holds in memory: the bytes it was decoded from, which its levels view. */
function sizeOf(tile: SpectralTile): number {
  return tile.values.buffer.byteLength;
}
