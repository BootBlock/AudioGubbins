/**
 * The shape of a spectrogram's tile pyramid (ADR-0080): its levels, the
 * frames each column spans, the windows each column takes the most of, and
 * the tiles that hold them.
 *
 * A tile holds 256 columns of one channel at one level, and every bin of the
 * window. A column of level `L` spans `hop · 2^L` frames of the sound and is
 * the per-bin maximum power of `min(2^L, 4)` windows centred evenly within it,
 * so the windows of a level lie `spacing` frames apart, the first centred half
 * a spacing into the sound: level 0 is the STFT at the hop, each level to level
 * 2 the most of twice the windows of the level below, and each above it four
 * windows twice as far apart again. A level is so analysed without the levels
 * below it, and a long sound is drawn at its coarsest level from the few
 * windows that level reads. Every position here is a whole frame, so a column's
 * start is the sample boundary the timeline's exact conversions place it at
 * (ADR-0041): the hop is at least 32 frames, so half a spacing and half a
 * window are whole.
 */

import { binsOf, hopOf, type SpectrogramConfig } from './spectrogram-config.js';

/** Columns a tile holds; the last tile of a level holds what is left. */
const TILE_COLUMNS = 256;

/** The most windows a column takes the maximum of. */
const MOST_WINDOWS_PER_COLUMN = 4;

/** One level of the pyramid. */
export interface LevelGeometry {
  readonly level: number;
  /** Frames a column spans: `hop · 2^level`. */
  readonly columnFrames: number;
  /** Windows a column takes the per-bin maximum of. */
  readonly windows: number;
  /** Frames between the centres of two windows of this level. */
  readonly spacing: number;
  readonly columns: number;
  readonly tiles: number;
}

/** The pyramid of a sound at some settings. */
export interface SpectrogramGeometry {
  readonly config: SpectrogramConfig;
  readonly frames: number;
  readonly channels: number;
  /** A tile's rows: the window's bins, 0 Hz first. */
  readonly bins: number;
  /** Level 0 first, up to the first level one tile holds whole. */
  readonly levels: readonly LevelGeometry[];
}

/** A half-open range of frames, `[start, end)`. */
export interface FrameRange {
  readonly start: number;
  readonly end: number;
}

/** The pyramid of a sound of `frames` frames and `channels` channels at `config`. */
export function spectrogramGeometry(
  config: SpectrogramConfig,
  frames: number,
  channels: number,
): SpectrogramGeometry {
  const hop = hopOf(config);
  const levels: LevelGeometry[] = [];
  for (let level = 0; ; level += 1) {
    const columnFrames = hop * 2 ** level;
    const windows = Math.min(2 ** level, MOST_WINDOWS_PER_COLUMN);
    const columns = Math.ceil(frames / columnFrames);
    const tiles = Math.ceil(columns / TILE_COLUMNS);
    levels.push({ level, columnFrames, windows, spacing: columnFrames / windows, columns, tiles });
    if (tiles <= 1) break;
  }
  return { config, frames, channels, bins: binsOf(config), levels };
}

/** Where a tile lies: its first frame and its columns. */
export interface TileSpan {
  readonly start: number;
  readonly columns: number;
}

/** The span of tile `index` of `level`. */
export function tileSpan(level: LevelGeometry, index: number): TileSpan {
  const first = index * TILE_COLUMNS;
  return {
    start: first * level.columnFrames,
    columns: Math.max(0, Math.min(TILE_COLUMNS, level.columns - first)),
  };
}

/** The frame at the middle of tile `index` of `level`, which the worker orders its work by. */
export function tileCentre(level: LevelGeometry, index: number): number {
  const span = tileSpan(level, index);
  return span.start + (span.columns * level.columnFrames) / 2;
}

/**
 * The first frame of window `window` of `level`, counted from the sound's
 * first window at that level: its centre is `(window + 1/2) · spacing`. It is
 * before the sound's start for the first windows, and the samples a window
 * reaches outside the sound are silence.
 */
export function windowStart(
  config: SpectrogramConfig,
  level: LevelGeometry,
  window: number,
): number {
  return window * level.spacing + level.spacing / 2 - config.windowLength / 2;
}

/**
 * The level a view draws from where a pixel spans `framesPerPixel` frames:
 * the coarsest whose columns are no wider than a pixel, or level 0 where a
 * pixel is narrower than its columns, which the view stretches.
 */
export function levelFor(geometry: SpectrogramGeometry, framesPerPixel: number): number {
  let chosen = 0;
  for (const level of geometry.levels) {
    if (level.columnFrames <= framesPerPixel) chosen = level.level;
  }
  return chosen;
}

/** The tiles of `level` a range of frames reaches, first and last, or `undefined` where none. */
export function tilesOver(
  level: LevelGeometry,
  range: FrameRange,
): { readonly first: number; readonly last: number } | undefined {
  const tileFrames = TILE_COLUMNS * level.columnFrames;
  const first = Math.max(0, Math.floor(range.start / tileFrames));
  const last = Math.min(level.tiles - 1, Math.ceil(range.end / tileFrames) - 1);
  return range.end > range.start && first <= last ? { first, last } : undefined;
}
