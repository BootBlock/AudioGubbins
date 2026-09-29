import type { SampleCount, SampleRate } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { StandardFrameRates } from './frame-rate.js';
import { gridPositions, rulerTicks } from './ruler.js';
import { TimePrecision, formatPosition, type TimeFormat } from './time-format.js';
import { pixelOf, type ViewportState } from './viewport.js';
import { pixelsPerSample, samplesPerPixel, type Zoom } from './zoom.js';

const RATE = 48_000 as SampleRate;
const CD = 44_100 as SampleRate;
const at = (value: number): SampleCount => value as SampleCount;

function view(start: number, zoom: Zoom, width = 1000): ViewportState {
  return { start: at(start), offset: 0, zoom, width };
}

const CLOCK: TimeFormat = { kind: 'clock' };

describe('writing a position', () => {
  it('writes samples grouped, milliseconds and a clock rounded down, and timecode', () => {
    expect(formatPosition(1_234_567, RATE, { kind: 'samples' })).toBe('1,234,567');
    expect(formatPosition(48_048, RATE, { kind: 'milliseconds' })).toBe('1,001 ms');
    expect(formatPosition(48_049, RATE, { kind: 'milliseconds' }, TimePrecision.Microseconds)).toBe(
      '1,001.020 ms',
    );
    expect(formatPosition(RATE * 61 + 47, RATE, CLOCK)).toBe('1:01.000');
    expect(formatPosition(RATE * 3723, RATE, CLOCK)).toBe('1:02:03.000');
    expect(formatPosition(1, CD, CLOCK, TimePrecision.Microseconds)).toBe('0:00.000022');
    expect(
      formatPosition(1920 * 26, RATE, { kind: 'timecode', frames: StandardFrameRates.pal }),
    ).toBe('00:00:01:01');
  });

  it('writes the same boundary the same way ten hours in, exactly', () => {
    const tenHours = 10 * 3600 * 44_100;
    expect(formatPosition(tenHours - 1, CD, CLOCK)).toBe('9:59:59.999');
    expect(formatPosition(tenHours, CD, CLOCK)).toBe('10:00:00.000');
  });
});

describe('the ruler', () => {
  it('spaces labelled ticks at least as far apart as asked, on round times', () => {
    const shown = view(0, samplesPerPixel(480));
    const ticks = rulerTicks(shown, at(RATE * 60), RATE, CLOCK, 80);
    const positions = ticks.major.map((tick) => tick.position);
    for (let index = 1; index < positions.length; index += 1) {
      expect(
        pixelOf(shown, positions[index]!) - pixelOf(shown, positions[index - 1]!),
      ).toBeGreaterThanOrEqual(80);
    }
    expect(ticks.major.slice(0, 3)).toEqual([
      { position: 0, label: '0:00.000' },
      { position: 48_000, label: '0:01.000' },
      { position: 96_000, label: '0:02.000' },
    ]);
    expect(ticks.minor.length).toBeGreaterThan(0);
  });

  it('puts a round time on the first boundary at or after it when the rate does not divide it', () => {
    const ticks = rulerTicks(view(0, pixelsPerSample(2)), at(CD), CD, CLOCK, 80);
    // One millisecond at 44.1 kHz is 44.1 samples: the tick sits on boundary 45.
    expect(ticks.major[1]).toEqual({ position: 45, label: '0:00.001' });
  });

  it('writes microseconds when ticks are closer than a millisecond', () => {
    const ticks = rulerTicks(view(0, pixelsPerSample(64)), at(RATE), RATE, CLOCK, 80);
    expect(ticks.major[1]?.label).toBe('0:00.000050');
  });

  it('counts samples on a sample ruler, and frames on a timecode ruler', () => {
    const samples = rulerTicks(
      view(0, pixelsPerSample(16)),
      at(RATE),
      RATE,
      { kind: 'samples' },
      80,
    );
    expect(samples.major.slice(0, 2).map((tick) => tick.position)).toEqual([0, 5]);
    const frames = rulerTicks(
      view(0, samplesPerPixel(40)),
      at(RATE * 10),
      RATE,
      { kind: 'timecode', frames: StandardFrameRates.pal },
      80,
    );
    expect(frames.major.slice(0, 2)).toEqual([
      { position: 0, label: '00:00:00:00' },
      { position: 1920 * 2, label: '00:00:00:02' },
    ]);
  });

  it('draws a bounded number of ticks however far out the view is', () => {
    const shown = view(0, samplesPerPixel(2 ** 36), 2000);
    const ticks = rulerTicks(shown, at(2 ** 53 - 1), RATE, CLOCK, 80);
    expect(ticks.major.length + ticks.minor.length).toBeLessThan(2000 / 6 + 2);
  });

  it('gives its ticks as the grid, in order', () => {
    const ticks = rulerTicks(view(0, samplesPerPixel(480)), at(RATE * 5), RATE, CLOCK, 80);
    const grid = gridPositions(ticks);
    expect(grid).toEqual([...grid].sort((a, b) => a - b));
    expect(grid.length).toBe(ticks.major.length + ticks.minor.length);
  });
});
