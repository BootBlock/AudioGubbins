import type { SampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import {
  StandardFrameRates,
  frameAt,
  frameRate,
  frameRatesEqual,
  frameStart,
  nominalFramesPerSecond,
} from './frame-rate.js';
import { timecodeOf, timecodeText } from './timecode.js';

const RATE = 48_000 as SampleRate;

function label(frame: number, rate = StandardFrameRates.ntscDropFrame): string {
  return timecodeText(timecodeOf(frame, rate));
}

describe('a frame rate', () => {
  it('is a ratio of whole numbers, with drop-frame only at the NTSC rates', () => {
    expect(expectSuccess(frameRate(30_000, 1001, true))).toEqual(StandardFrameRates.ntscDropFrame);
    expect(expectFailureCode(frameRate(25, 1, true))).toBe('timeline.drop-frame-not-ntsc');
    expect(expectFailureCode(frameRate(24.5, 1, false))).toBe('timeline.frame-rate-out-of-range');
    expect(expectFailureCode(frameRate(0, 1, false))).toBe('timeline.frame-rate-out-of-range');
    expect(nominalFramesPerSecond(StandardFrameRates.filmPulledDown)).toBe(24);
    expect(frameRatesEqual(StandardFrameRates.pal, expectSuccess(frameRate(50, 2, false)))).toBe(
      true,
    );
  });
});

describe('frames and boundaries', () => {
  it('puts each frame at the first boundary at or after its time, and finds it again', () => {
    // 25 frames a second at 48 kHz is exactly 1920 samples a frame.
    expect(frameStart(1, RATE, StandardFrameRates.pal)).toBe(1920);
    expect(frameAt(1919, RATE, StandardFrameRates.pal)).toBe(0);
    expect(frameAt(1920, RATE, StandardFrameRates.pal)).toBe(1);
    // 29.97 is 1601.6 samples a frame: frame 1 starts at 1602.
    expect(frameStart(1, RATE, StandardFrameRates.ntscNonDrop)).toBe(1602);
    expect(frameAt(1601, RATE, StandardFrameRates.ntscNonDrop)).toBe(0);
    expect(frameAt(1602, RATE, StandardFrameRates.ntscNonDrop)).toBe(1);
  });

  it('keeps every frame exact twenty-four hours in, where a float of the rate would have drifted', () => {
    const rate = StandardFrameRates.filmPulledDown;
    const day = 24 * 3600 * 24;
    for (let frame = day - 5; frame <= day + 5; frame += 1) {
      const start = frameStart(frame, RATE, rate);
      expect(frameAt(start, RATE, rate)).toBe(frame);
      expect(frameAt(start - 1, RATE, rate)).toBe(frame - 1);
    }
  });

  it('counts frames before the picture as negative', () => {
    expect(frameAt(-1, RATE, StandardFrameRates.pal)).toBe(-1);
    expect(frameStart(-1, RATE, StandardFrameRates.pal)).toBe(-1920);
  });
});

describe('timecode', () => {
  it('labels non-drop frames as the nominal rate counts them', () => {
    expect(label(0, StandardFrameRates.pal)).toBe('00:00:00:00');
    expect(label(25 * 3661 + 24, StandardFrameRates.pal)).toBe('01:01:01:24');
  });

  it('skips the first two labels of each minute but every tenth at 29.97 drop-frame', () => {
    expect(label(1799)).toBe('00:00:59;29');
    expect(label(1800)).toBe('00:01:00;02');
    expect(label(17_981)).toBe('00:09:59;29');
    expect(label(17_982)).toBe('00:10:00;00');
    // One hour of frames at 29.97 is labelled one hour.
    expect(label(107_892)).toBe('01:00:00;00');
  });

  it('skips four labels a minute at 59.94 drop-frame', () => {
    expect(label(3599, StandardFrameRates.ntscDoubleDropFrame)).toBe('00:00:59;59');
    expect(label(3600, StandardFrameRates.ntscDoubleDropFrame)).toBe('00:01:00;04');
  });

  it('writes a frame before the picture with the typographic minus', () => {
    expect(label(-25, StandardFrameRates.pal)).toBe('−00:00:01:00');
  });
});
