import { describe, expect, it } from 'vitest';

import { timeOfDay } from './time-of-day.js';

/** A moment on 5 October 2026 in the runtime's own time zone, as a reader sees it. */
function at(hours: number, minutes: number, seconds: number): number {
  return new Date(2026, 9, 5, hours, minutes, seconds).getTime();
}

describe('a time of day, as a sentence writes it', () => {
  it('is written to the second in two digits each', () => {
    expect(timeOfDay(at(9, 5, 7))).toBe('09:05:07');
  });

  it('takes the 24-hour clock, from midnight as 00', () => {
    expect(timeOfDay(at(0, 0, 1))).toBe('00:00:01');
    expect(timeOfDay(at(23, 59, 59))).toBe('23:59:59');
  });

  it('drops the part of a second, so a moment is written as the second it falls in', () => {
    expect(timeOfDay(at(14, 5, 9) + 999)).toBe('14:05:09');
  });
});
