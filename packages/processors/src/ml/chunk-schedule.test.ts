import { describe, expect, it } from 'vitest';

import { scheduledRun } from './chunk-schedule.js';

const SCHEDULE = { chunk: 1_000, warmUp: 400 };

describe('a chunk schedule', () => {
  it("runs the first chunk from the stream's start, hearing what follows in the warm-up's place", () => {
    expect(scheduledRun(SCHEDULE, 0)).toEqual({ first: 0, length: 1_400, kept: 0, offset: 0 });
  });

  it('runs every later chunk after its warm-up, keeping the chunk alone, every run one length', () => {
    expect(scheduledRun(SCHEDULE, 1)).toEqual({
      first: 600,
      length: 1_400,
      kept: 1_000,
      offset: 400,
    });
    expect(scheduledRun(SCHEDULE, 7)).toEqual({
      first: 6_600,
      length: 1_400,
      kept: 7_000,
      offset: 400,
    });
  });

  it('refuses a warm-up longer than its chunk, which would reach before the stream', () => {
    expect(() => scheduledRun({ chunk: 100, warmUp: 101 }, 1)).toThrow();
  });
});
