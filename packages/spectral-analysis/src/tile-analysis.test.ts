/**
 * Making tiles from the canonical STFT: a tone's level at its bin, silence as
 * the floor, the levels above level 0 as the maxima of its windows, the
 * channels of one pass as each made alone, the windows of a coarse level read
 * alone, and the work stopped when it is cancelled.
 */

import { describe, expect, it } from 'vitest';

import {
  REFERENCE_DSP,
  StftWindow,
  frameBlock,
  memorySource,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import {
  Cancelled,
  createCancellationSource,
  discreteLayout,
  sampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { impulse, noise, sine } from '@audiogubbins/test-fixtures';

import { type SpectrogramConfig } from './spectrogram-config.js';
import { analyseTiles } from './tile-analysis.js';
import { spectrogramGeometry, tileSpan, type SpectrogramGeometry } from './tile-geometry.js';

const RATE = expectSuccess(sampleRate(48_000));

const SHORT: SpectrogramConfig = { windowLength: 256, window: StftWindow.Hann, overlap: 1 };

/** A source of `channels` held in memory, counting the frames read from it. */
function counted(channels: readonly Float32Array[]): { source: PcmSource; read: () => number } {
  const inner = expectSuccess(
    memorySource(
      expectSuccess(
        frameBlock(expectSuccess(discreteLayout(channels.length)), RATE, [...channels]),
      ),
    ),
  );
  let frames = 0;
  return {
    source: {
      ...inner,
      read: async (start, into, signal) => {
        const read = await inner.read(start, into, signal);
        frames += read;
        return read;
      },
    },
    read: () => frames,
  };
}

const settled = (): Promise<void> => Promise.resolve();

async function tiles(
  geometry: SpectrogramGeometry,
  source: PcmSource,
  level: number,
  index: number,
  channels: readonly number[] = [0],
): Promise<readonly Uint8Array[]> {
  return analyseTiles(
    { geometry, level, index, channels },
    {
      source,
      dsp: REFERENCE_DSP,
      yieldToHost: settled,
      signal: createCancellationSource().signal,
    },
  );
}

/** Column `column` of a tile `columns` wide, bin by bin. */
function columnOf(tile: Uint8Array, columns: number, bins: number, column: number): number[] {
  return Array.from({ length: bins }, (_, bin) => tile[bin * columns + column]!);
}

/** An amplitude a quarter of a step below a level's start, so its byte is that level's. */
const AMPLITUDE_AT_242 = 10 ** (-6.25 / 20);

describe('a tile', () => {
  it('shows a tone centred on a bin at its level there, a decibel at a time', async () => {
    // Bin 16 of a 256-sample window at 48 kHz is centred on 3 kHz.
    const tone = sine(3000, { amplitude: AMPLITUDE_AT_242, length: 256 * 64 }).channels;
    const geometry = spectrogramGeometry(SHORT, 256 * 64, 1);
    const [tile] = await tiles(geometry, counted(tone).source, 0, 0);
    const columns = tileSpan(geometry.levels[0]!, 0).columns;
    expect(tile).toHaveLength(64 * 129);
    for (const column of [10, 30, 50]) {
      const levels = columnOf(tile!, columns, 129, column);
      expect(levels[16]).toBe(242);
      // The Hann window's neighbouring bins are 6.02 dB down.
      expect([levels[15], levels[17]]).toEqual([230, 230]);
      expect(levels[60]).toBeLessThan(100);
    }
  });

  it('keeps the Blackman–Harris window’s side lobes 92 dB down', async () => {
    const config = { ...SHORT, window: StftWindow.BlackmanHarris };
    const tone = sine(3000, { amplitude: AMPLITUDE_AT_242, length: 256 * 64 }).channels;
    const geometry = spectrogramGeometry(config, 256 * 64, 1);
    const [tile] = await tiles(geometry, counted(tone).source, 0, 0);
    const levels = columnOf(tile!, 64, 129, 30);
    expect(levels[16]).toBe(242);
    const far = levels.filter((_, bin) => Math.abs(bin - 16) >= 4);
    // −92 dB below the tone's −6.25 dBFS is byte 58.
    expect(Math.max(...far)).toBeLessThanOrEqual(58);
  });

  it('is the floor everywhere for silence', async () => {
    const geometry = spectrogramGeometry(DEFAULT_LIKE, 50_000, 1);
    const [tile] = await tiles(geometry, counted([new Float32Array(50_000)]).source, 0, 0);
    expect(tile).toHaveLength(tileSpan(geometry.levels[0]!, 0).columns * geometry.bins);
    expect(tile!.every((level) => level === 0)).toBe(true);
  });

  it('makes each column above level 0 the most of the windows it spans, to the level 0 bytes', async () => {
    const config: SpectrogramConfig = { windowLength: 256, window: StftWindow.Hann, overlap: 2 };
    const frames = 128 * 256 * 4 + 1000;
    const audio = noise(7, { length: frames, amplitude: 0.5 }).channels;
    const geometry = spectrogramGeometry(config, frames, 1);
    const { source } = counted(audio);
    const zero = await Promise.all(
      [0, 1, 2, 3].map(async (index) => (await tiles(geometry, source, 0, index))[0]!),
    );
    const level0 = (column: number): number[] =>
      columnOf(zero[Math.floor(column / 256)]!, 256, 129, column % 256);
    const [one] = await tiles(geometry, source, 1, 0);
    const [two] = await tiles(geometry, source, 2, 0);
    for (const column of [0, 1, 100, 255]) {
      expect(columnOf(one!, 256, 129, column)).toEqual(
        level0(2 * column).map((level, bin) => Math.max(level, level0(2 * column + 1)[bin]!)),
      );
    }
    for (const column of [0, 63, 200]) {
      const parts = [0, 1, 2, 3].map((part) => level0(4 * column + part));
      expect(columnOf(two!, 256, 129, column)).toEqual(
        parts[0]!.map((_, bin) => Math.max(...parts.map((part) => part[bin]!))),
      );
    }
  });

  it('makes each channel of one pass as it makes that channel alone', async () => {
    const frames = 256 * 300;
    const left = noise(3, { length: frames }).channels[0]!;
    const right = noise(4, { length: frames }).channels[0]!;
    const geometry = spectrogramGeometry(SHORT, frames, 2);
    const { source } = counted([left, right]);
    const both = await tiles(geometry, source, 1, 0, [1, 0]);
    expect(both[0]).toEqual((await tiles(geometry, source, 1, 0, [1]))[0]);
    expect(both[1]).toEqual((await tiles(geometry, source, 1, 0, [0]))[0]);
    expect(both[0]).not.toEqual(both[1]);
  });

  it('reads silence where a window reaches before the sound', async () => {
    const geometry = spectrogramGeometry(SHORT, 256 * 8, 1);
    const [tile] = await tiles(
      geometry,
      counted(impulse(10, { length: 256 * 8 }).channels).source,
      0,
      0,
    );
    expect(columnOf(tile!, 8, 129, 0).every((level) => level > 0)).toBe(true);
    expect(columnOf(tile!, 8, 129, 1).every((level) => level === 0)).toBe(true);
  });

  it('reads the windows of a coarse level alone where they lie apart, and nothing between them', async () => {
    // Level 3 of a 256-sample window at a hop of 256: windows 512 frames apart.
    const frames = 2048 * 300;
    const audio = new Float32Array(frames);
    // Inside column 5's third window, and between column 7's first two.
    audio[5 * 2048 + 256 + 2 * 512 + 10] = 1;
    audio[7 * 2048 + 256 + 200] = 1;
    const geometry = spectrogramGeometry(SHORT, frames, 1);
    expect(geometry.levels[3]?.spacing).toBe(512);
    const { source, read } = counted([audio]);
    const [tile] = await tiles(geometry, source, 3, 0);
    const lit = Array.from({ length: 256 }, (_, column) =>
      columnOf(tile!, 256, 129, column).some((level) => level > 0),
    );
    expect(lit.map((on, column) => (on ? column : -1)).filter((one) => one >= 0)).toEqual([5]);
    expect(read()).toBe(256 * 4 * 256);
  });

  it('reads a long sound’s coarsest tile from its windows alone', async () => {
    const frames = 2 ** 22;
    const geometry = spectrogramGeometry(SHORT, frames, 1);
    const top = geometry.levels.length - 1;
    const { source, read } = counted([new Float32Array(frames)]);
    await tiles(geometry, source, top, 0);
    expect(read()).toBe(256 * 4 * 256);
    expect(read()).toBeLessThan(frames / 8);
  });

  it('stops at the next chunk once its signal is cancelled', async () => {
    const frames = 65_536 * 6;
    const geometry = spectrogramGeometry(
      { windowLength: 4096, window: StftWindow.Hann, overlap: 2 },
      frames,
      1,
    );
    const cancel = createCancellationSource();
    const { source, read } = counted([new Float32Array(frames)]);
    const work = analyseTiles(
      { geometry, level: 0, index: 0, channels: [0] },
      {
        source,
        dsp: REFERENCE_DSP,
        yieldToHost: () => {
          cancel.cancel(new Cancelled('The view moved on.'));
          return Promise.resolve();
        },
        signal: cancel.signal,
      },
    );
    await expect(work).rejects.toThrow('The view moved on.');
    // The first chunk starts half a window before the sound, half a hop
    // before the first window's centre, and reads silence there.
    expect(read()).toBe(65_536 - 1024);
  });
});

const DEFAULT_LIKE: SpectrogramConfig = {
  windowLength: 2048,
  window: StftWindow.BlackmanHarris,
  overlap: 4,
};
