import { describe, expect, it } from 'vitest';

import { scheduledRun } from './chunk-schedule.js';

/** A warm-up before each chunk and nothing after, the first chunk no longer. */
const WARMED = { chunk: 1_000, before: 400, after: 0, firstChunk: 1_000 };

/** Context on both sides of each chunk, the first keeping all but its `after`. */
const CENTRED = { chunk: 144_000, before: 24_000, after: 24_000, firstChunk: 168_000 };

describe('a chunk schedule', () => {
  it("runs the first chunk from the stream's start, hearing what follows in the warm-up's place", () => {
    expect(scheduledRun(WARMED, 0)).toEqual({
      first: 0,
      length: 1_400,
      kept: 0,
      keeps: 1_000,
      offset: 0,
    });
  });

  it('runs every later chunk after its warm-up, keeping the chunk alone, every run one length', () => {
    expect(scheduledRun(WARMED, 1)).toEqual({
      first: 600,
      length: 1_400,
      kept: 1_000,
      keeps: 1_000,
      offset: 400,
    });
    expect(scheduledRun(WARMED, 7)).toEqual({
      first: 6_600,
      length: 1_400,
      kept: 7_000,
      keeps: 1_000,
      offset: 400,
    });
  });

  it('hears context after each chunk as well as before, the first chunk keeping its context before', () => {
    expect(scheduledRun(CENTRED, 0)).toEqual({
      first: 0,
      length: 192_000,
      kept: 0,
      keeps: 168_000,
      offset: 0,
    });
    expect(scheduledRun(CENTRED, 1)).toEqual({
      first: 144_000,
      length: 192_000,
      kept: 168_000,
      keeps: 144_000,
      offset: 24_000,
    });
    expect(scheduledRun(CENTRED, 2)).toMatchObject({ first: 288_000, kept: 312_000 });
  });

  it('keeps each frame in exactly one run, the runs meeting end to end', () => {
    for (const schedule of [WARMED, CENTRED]) {
      for (let index = 0; index < 5; index += 1) {
        const run = scheduledRun(schedule, index);
        const next = scheduledRun(schedule, index + 1);
        expect(run.kept + run.keeps).toBe(next.kept);
        expect(run.offset + run.keeps + schedule.after).toBeLessThanOrEqual(run.length);
      }
    }
  });

  it('refuses a first chunk that would have the second run reach before the stream', () => {
    expect(() => scheduledRun({ chunk: 100, before: 101, after: 0, firstChunk: 100 }, 1)).toThrow();
  });

  it('refuses a first chunk that keeps frames its run hears no context after', () => {
    expect(() => scheduledRun({ chunk: 100, before: 20, after: 20, firstChunk: 121 }, 0)).toThrow();
  });
});
