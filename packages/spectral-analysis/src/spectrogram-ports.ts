/**
 * What a spectrogram's host is given and gives: the cache it keeps tiles in,
 * what it reports, what a view says it shows, and whether a sound's
 * spectrogram can be drawn, which a view's lanes say where they cannot.
 */

import type { CancellationSignal } from '@audiogubbins/domain';

import type { SpectrogramConfig } from './spectrogram-config.js';
import type { SpectralTileKey } from './spectral-tile.js';

/** Whether a sound's spectrogram can be drawn, and why not where it cannot. */
export type SpectrogramStatus =
  { readonly kind: 'running' } | { readonly kind: 'failed'; readonly reason: string };

/** What a job tells whoever keeps a record of it. */
export type SpectrogramEvent =
  | { readonly kind: 'cache-refused'; readonly identity: string; readonly reason: string }
  | { readonly kind: 'cache-unreadable'; readonly identity: string; readonly reason: string }
  | { readonly kind: 'cache-unwritten'; readonly identity: string; readonly reason: string }
  | { readonly kind: 'failed'; readonly identity: string; readonly reason: string };

/** Where tiles are kept between sessions: a disposable cache, one revision of a source at a time. */
export interface SpectralTileCache {
  /** The bytes kept for `key`, or `undefined`; the read stops when `signal` is cancelled. */
  read(
    key: SpectralTileKey,
    signal: CancellationSignal,
  ): Promise<Uint8Array<ArrayBuffer> | undefined>;
  /**
   * Keeps `bytes` for `key`, letting go of the tiles of the source's other
   * revisions. The bytes stay the page's: a store that moves them copies them.
   */
  write(key: SpectralTileKey, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}

/** What one view of a sound shows: one level's tiles of some channels, around a frame. */
export interface SpectrogramView {
  readonly config: SpectrogramConfig;
  readonly level: number;
  readonly channels: readonly number[];
  /** The first and last tiles shown, inclusive. */
  readonly first: number;
  readonly last: number;
  /** The frame at the view's centre, which the nearest tiles are made around first. */
  readonly centre: number;
}
