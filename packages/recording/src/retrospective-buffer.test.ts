import { describe, expect, it } from 'vitest';

import { derivedSampleCount, sampleRate, type DomainResult } from '@audiogubbins/domain';

import {
  RETROSPECTIVE_OFF,
  retrospectiveFrames,
  retrospectiveMemory,
  retrospectiveOn,
  retrospectiveStart,
} from './retrospective-buffer.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE = valueOf(sampleRate(48_000));
const frames = derivedSampleCount;

describe('the retrospective buffer (REQ-REC-090)', () => {
  it('keeps between five and sixty seconds', () => {
    expect(retrospectiveOn(5)).toEqual({ ok: true, value: { on: true, seconds: 5 } });
    expect(retrospectiveOn(60).ok).toBe(true);
    for (const seconds of [4.99, 60.01, 0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(retrospectiveOn(seconds)).toMatchObject({
        ok: false,
        failures: [{ code: 'recording.retrospective-out-of-range' }],
      });
    }
  });

  it('holds a whole frame for any part of one, and costs four bytes a sample', () => {
    expect(retrospectiveFrames(10, RATE)).toBe(480_000);
    expect(retrospectiveFrames(5, valueOf(sampleRate(44_101)))).toBe(220_505);
    expect(retrospectiveFrames(5.00001, valueOf(sampleRate(8_000)))).toBe(40_001);
    expect(retrospectiveMemory(60, RATE, 2)).toBe(60 * 48_000 * 2 * 4);
  });

  it('begins a take with every frame held, up to the capacity, and never before the clock', () => {
    const tenSeconds = valueOf(retrospectiveOn(10));
    expect(retrospectiveStart(tenSeconds, RATE, frames(2_000_000), frames(1_000_000))).toEqual({
      firstFrame: 520_000,
      frames: 480_000,
    });
    expect(retrospectiveStart(tenSeconds, RATE, frames(48_000), frames(1_000_000))).toEqual({
      firstFrame: 952_000,
      frames: 48_000,
    });
    expect(retrospectiveStart(tenSeconds, RATE, frames(480_000), frames(1_000))).toEqual({
      firstFrame: 0,
      frames: 1_000,
    });
  });

  it('begins a take at Record with the buffer off, whatever the worklet reports', () => {
    expect(retrospectiveStart(RETROSPECTIVE_OFF, RATE, frames(48_000), frames(96_000))).toEqual({
      firstFrame: 96_000,
      frames: 0,
    });
  });
});
