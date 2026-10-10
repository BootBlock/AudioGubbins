/**
 * A spectrogram's settings, the shape of its tile pyramid and the exact
 * placement of its columns and windows, and the levels its bytes stand for.
 */

import { describe, expect, it } from 'vitest';

import { StftWindow } from '@audiogubbins/audio-engine';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  LEVEL_FLOOR_DECIBELS,
  levelDecibels,
  levelThresholds,
  quantisedLevel,
} from './level-quantisation.js';
import {
  DEFAULT_SPECTROGRAM_CONFIG,
  binsOf,
  configAt,
  hopOf,
  spectrogramConfig,
  type SpectrogramConfig,
} from './spectrogram-config.js';
import {
  TILE_COLUMNS,
  levelFor,
  spectrogramGeometry,
  tileCentre,
  tileSpan,
  tilesOver,
  windowStart,
} from './tile-geometry.js';

const SHORT: SpectrogramConfig = { windowLength: 256, window: StftWindow.Hann, overlap: 1 };

describe('a spectrogram’s settings', () => {
  it('takes a power-of-two window from 256 to 32 768 samples, either window, and an overlap of 1, 2, 4 or 8', () => {
    for (const windowLength of [256, 2048, 32_768]) {
      for (const overlap of [1, 2, 4, 8]) {
        expect(spectrogramConfig({ windowLength, window: StftWindow.Hann, overlap }).ok).toBe(true);
      }
    }
    expect(expectSuccess(spectrogramConfig(DEFAULT_SPECTROGRAM_CONFIG))).toEqual({
      windowLength: 2048,
      window: StftWindow.BlackmanHarris,
      overlap: 4,
    });
  });

  it.each([
    ['a window shorter than 256 samples', { windowLength: 128, window: 'hann', overlap: 4 }],
    ['a window longer than 32 768 samples', { windowLength: 65_536, window: 'hann', overlap: 4 }],
    ['a window not a power of two', { windowLength: 3000, window: 'hann', overlap: 4 }],
    ['a window of no kind it knows', { windowLength: 2048, window: 'kaiser', overlap: 4 }],
    ['an overlap of three', { windowLength: 2048, window: 'hann', overlap: 3 }],
  ])('refuses %s', (_case, settings) => {
    expect(expectFailureCode(spectrogramConfig(settings))).toBe('spectral.config-invalid');
  });

  it('reads settings that crossed a thread, and refuses settings it would refuse', () => {
    expect(configAt({ config: { ...SHORT } }, 'config')).toEqual(SHORT);
    expect(() => configAt({ config: { ...SHORT, overlap: 16 } }, 'config')).toThrow(
      "The message's config is not a spectrogram’s settings.",
    );
    expect(() => configAt({ config: { ...SHORT, window: 1 } }, 'config')).toThrow('config');
  });

  it('steps by the window over the overlap, and has a bin from 0 Hz to half the rate', () => {
    expect(hopOf(DEFAULT_SPECTROGRAM_CONFIG)).toBe(512);
    expect(binsOf(DEFAULT_SPECTROGRAM_CONFIG)).toBe(1025);
  });
});

describe('the tile pyramid', () => {
  it('has levels up to the first one tile holds whole, each column twice as wide as the level below', () => {
    const geometry = spectrogramGeometry(DEFAULT_SPECTROGRAM_CONFIG, 10_000_000, 2);
    expect(geometry.bins).toBe(1025);
    expect(geometry.levels.map((level) => level.columnFrames)).toEqual(
      geometry.levels.map((_, level) => 512 * 2 ** level),
    );
    expect(geometry.levels.map((level) => level.tiles)).toEqual([77, 39, 20, 10, 5, 3, 2, 1]);
    expect(geometry.levels.at(-1)?.tiles).toBe(1);
    expect(geometry.levels[0]?.columns).toBe(Math.ceil(10_000_000 / 512));
  });

  it('takes the most of 1, 2 and then 4 windows a column, evenly spaced within it', () => {
    const geometry = spectrogramGeometry(DEFAULT_SPECTROGRAM_CONFIG, 100_000_000, 1);
    expect(geometry.levels.slice(0, 5).map((level) => [level.windows, level.spacing])).toEqual([
      [1, 512],
      [2, 512],
      [4, 512],
      [4, 1024],
      [4, 2048],
    ]);
    for (const level of geometry.levels) {
      // Column 7's windows are centred at the middles of its equal parts.
      const centres = Array.from(
        { length: level.windows },
        (_, part) =>
          windowStart(DEFAULT_SPECTROGRAM_CONFIG, level, 7 * level.windows + part) + 1024,
      );
      expect(centres).toEqual(
        Array.from(
          { length: level.windows },
          (_, part) => 7 * level.columnFrames + (part + 0.5) * level.spacing,
        ),
      );
      expect(centres.every(Number.isInteger)).toBe(true);
    }
  });

  it('starts every column on a whole frame, far into a long sound', () => {
    const frames = 2 ** 40;
    const geometry = spectrogramGeometry(SHORT, frames, 1);
    for (const level of geometry.levels) {
      const last = level.tiles - 1;
      const span = tileSpan(level, last);
      expect(span.start).toBe(last * TILE_COLUMNS * level.columnFrames);
      expect(Number.isSafeInteger(span.start)).toBe(true);
      expect(span.start + span.columns * level.columnFrames).toBeGreaterThanOrEqual(frames);
    }
  });

  it('gives the last tile of a level the columns that are left', () => {
    const level = spectrogramGeometry(SHORT, 300 * 256, 1).levels[0]!;
    expect([tileSpan(level, 0), tileSpan(level, 1)]).toEqual([
      { start: 0, columns: 256 },
      { start: 256 * 256, columns: 44 },
    ]);
    expect(tileCentre(level, 1)).toBe(256 * 256 + 22 * 256);
  });

  it('draws from the coarsest level whose columns are no wider than a pixel, and stretches level 0', () => {
    const geometry = spectrogramGeometry(DEFAULT_SPECTROGRAM_CONFIG, 10_000_000, 1);
    expect(levelFor(geometry, 100)).toBe(0);
    expect(levelFor(geometry, 512)).toBe(0);
    expect(levelFor(geometry, 1023)).toBe(0);
    expect(levelFor(geometry, 1024)).toBe(1);
    expect(levelFor(geometry, 5000)).toBe(3);
    expect(levelFor(geometry, 1e12)).toBe(geometry.levels.length - 1);
  });

  it('names the tiles a range of frames reaches, and none for an empty range or one past the sound', () => {
    const level = spectrogramGeometry(SHORT, 10 * 65_536, 1).levels[0]!;
    expect(tilesOver(level, { start: 0, end: 65_536 })).toEqual({ first: 0, last: 0 });
    expect(tilesOver(level, { start: 65_535, end: 65_537 })).toEqual({ first: 0, last: 1 });
    expect(tilesOver(level, { start: 3 * 65_536, end: 99 * 65_536 })).toEqual({
      first: 3,
      last: 9,
    });
    expect(tilesOver(level, { start: 5, end: 5 })).toBeUndefined();
    expect(tilesOver(level, { start: 11 * 65_536, end: 12 * 65_536 })).toBeUndefined();
  });

  it('has one level and no tiles for a sound of no frames', () => {
    expect(spectrogramGeometry(SHORT, 0, 1).levels).toEqual([
      { level: 0, columnFrames: 256, windows: 1, spacing: 256, columns: 0, tiles: 0 },
    ]);
  });
});

describe('the quantised level', () => {
  it('stands for half-decibel steps from −127.5 dBFS', () => {
    expect([levelDecibels(0), levelDecibels(1), levelDecibels(255)]).toEqual([
      LEVEL_FLOOR_DECIBELS,
      -127,
      0,
    ]);
  });

  it('begins 0 dBFS at the power of a full-scale sine centred on a bin through the window', () => {
    // N · a₀ / 2, squared: a sine of amplitude 1 reaches half the window's sum.
    expect(levelThresholds(SHORT)[254]).toBe(64 ** 2);
    const blackmanHarris = levelThresholds({ ...SHORT, window: StftWindow.BlackmanHarris });
    expect(blackmanHarris[254]).toBe(((256 * 0.358_75) / 2) ** 2);
  });

  it('makes each threshold half a decibel above the one before', () => {
    const thresholds = levelThresholds(DEFAULT_SPECTROGRAM_CONFIG);
    expect(thresholds).toHaveLength(255);
    for (let level = 1; level < thresholds.length; level += 1) {
      const step = 10 * Math.log10(thresholds[level]! / thresholds[level - 1]!);
      expect(step).toBeCloseTo(0.5, 9);
    }
  });

  it('is the count of thresholds a power reaches, silence and every quieter power 0, every louder 255', () => {
    const thresholds = levelThresholds(DEFAULT_SPECTROGRAM_CONFIG);
    expect(quantisedLevel(0, thresholds)).toBe(0);
    expect(quantisedLevel(thresholds[0]! * 0.99, thresholds)).toBe(0);
    for (const level of [1, 2, 100, 254, 255]) {
      const threshold = thresholds[level - 1]!;
      expect(quantisedLevel(threshold, thresholds)).toBe(level);
      expect(quantisedLevel(threshold * (1 - 1e-12), thresholds)).toBe(level - 1);
    }
    expect(quantisedLevel(thresholds[254]! * 1e6, thresholds)).toBe(255);
    expect(quantisedLevel(Number.NaN, thresholds)).toBe(0);
  });
});
