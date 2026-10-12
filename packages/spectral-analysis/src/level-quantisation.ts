/**
 * A tile's value: a bin's power as a quantised level (ADR-0080).
 *
 * The level is the power relative to a full-scale sine at the bin's centre
 * through the same window, a byte in half-decibel steps: 0 below −127 dBFS,
 * silence included, up to 255 at 0 dBFS and above, the byte `b` meaning the
 * power reached `−127.5 + b / 2` dBFS. It is found by comparing the power with
 * a table of thresholds, so no logarithm is taken per bin; the table is made
 * by the canonical power function (ADR-0032), so every machine makes the same
 * table, and with the canonical STFT the same tile. The displayed range and
 * colours map the bytes and never change a tile.
 */

import { StftWindow, pow } from '@audiogubbins/audio-engine';

import type { SpectrogramConfig } from './spectrogram-config.js';

/** The level the byte 0 stands for, and the floor of every quieter power. */
export const LEVEL_FLOOR_DECIBELS = -127.5;

/** Decibels between the levels of two adjacent bytes. */
export const LEVEL_STEP_DECIBELS = 0.5;

/** The highest byte, 0 dBFS and above. */
const HIGHEST_LEVEL = 255;

/**
 * Each window's first term, `a₀`: its mean weight. A periodic window of `N`
 * samples sums to `N · a₀`, its other terms' cosines summing to nothing over
 * the period, so a full-scale sine centred on a bin reaches `N · a₀ / 2` there.
 */
const MEAN_WEIGHT: Readonly<Record<StftWindow, number>> = {
  [StftWindow.Hann]: 0.5,
  [StftWindow.BlackmanHarris]: 0.358_75,
};

/** The decibels the byte `level` stands for. */
export function levelDecibels(level: number): number {
  return LEVEL_FLOOR_DECIBELS + LEVEL_STEP_DECIBELS * level;
}

/** Each table made, by window and length, for the life of the thread (G5). */
const TABLES = new Map<string, Float64Array>();

/**
 * The powers at which each byte from 1 to 255 begins, for windows of
 * `config`'s kind and length: entry `b − 1` is the power of the level
 * `levelDecibels(b)`.
 */
export function levelThresholds(config: SpectrogramConfig): Float64Array {
  const name = `${config.window}/${String(config.windowLength)}`;
  const kept = TABLES.get(name);
  if (kept !== undefined) return kept;
  const amplitude = (config.windowLength * MEAN_WEIGHT[config.window]) / 2;
  const fullScale = amplitude * amplitude;
  const table = new Float64Array(HIGHEST_LEVEL);
  for (let level = 1; level <= HIGHEST_LEVEL; level += 1) {
    table[level - 1] = fullScale * pow(10, levelDecibels(level) / 10);
  }
  TABLES.set(name, table);
  return table;
}

/** The byte of `power`: how many of `thresholds` it reaches, by bisection. */
export function quantisedLevel(power: number, thresholds: Float64Array): number {
  let low = 0;
  let high = thresholds.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (power >= (thresholds[middle] ?? Infinity)) low = middle + 1;
    else high = middle;
  }
  return low;
}
