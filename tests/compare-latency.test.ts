import { describe, expect, it } from 'vitest';

import { compareRuns, parseArguments, quantile, seededRandom } from '../tools/compare-latency.mjs';

/**
 * The comparison that judges the editing-latency runs before and after the
 * Phase 16 redesign. The samples here are drawn from a seeded generator, so a
 * case states the distribution it compares rather than a list of numbers.
 */

/** `count` samples around `centre`, spread uniformly over `spread` milliseconds. */
function samplesAround(centre: number, spread: number, count: number, seed: number): number[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => centre - spread / 2 + random() * spread);
}

describe('compare-latency', () => {
  it('interpolates a quantile between the nearest ranks', () => {
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40], 0)).toBe(10);
    expect(quantile([10, 20, 30, 40], 1)).toBe(40);
  });

  it('finds no regression between two runs of the same distribution', () => {
    const before = samplesAround(20, 16, 400, 1);
    const after = samplesAround(20, 16, 400, 2);
    expect(compareRuns([before], [after]).map((result) => result.regressed)).toEqual([
      false,
      false,
    ]);
  });

  it('finds no regression in a slowdown within the tolerance', () => {
    const before = samplesAround(20, 16, 400, 1);
    const after = samplesAround(21, 16, 400, 2);
    expect(compareRuns([before], [after]).some((result) => result.regressed)).toBe(false);
  });

  it('refuses a slowdown beyond the tolerance in the median and the 90th percentile', () => {
    const before = samplesAround(20, 16, 400, 1);
    const after = samplesAround(30, 16, 400, 2);
    expect(compareRuns([before], [after]).map((result) => result.regressed)).toEqual([true, true]);
  });

  it('refuses a slow tail even when the median holds', () => {
    const before = samplesAround(20, 4, 400, 1);
    const after = samplesAround(20, 4, 400, 2).map((value, index) =>
      index % 5 === 0 ? value + 30 : value,
    );
    const [median, p90] = compareRuns([before], [after]);
    expect(median?.regressed).toBe(false);
    expect(p90?.regressed).toBe(true);
  });

  it('gives the same interval for the same runs', () => {
    const before = samplesAround(20, 16, 200, 1);
    const after = samplesAround(22, 16, 200, 2);
    expect(compareRuns([before], [after])).toEqual(compareRuns([before], [after]));
  });

  it('finds no regression in runs inside the spread between the baseline runs', () => {
    // Three baseline runs of the same code, each moved by the machine's load,
    // and current runs inside their spread. One run against one calls it a
    // regression, because the samples inside a run cannot see the runs move.
    const baseline = [6, 9, 7].map((centre, index) => samplesAround(centre, 3, 200, index + 1));
    const current = [9, 8, 7].map((centre, index) => samplesAround(centre, 3, 200, index + 10));
    expect(compareRuns([baseline[0] ?? []], [current[0] ?? []])[0]?.regressed).toBe(true);
    expect(compareRuns(baseline, current).some((result) => result.regressed)).toBe(false);
  });

  it('refuses a slowdown beyond the spread between the baseline runs', () => {
    const baseline = [6, 9, 7].map((centre, index) => samplesAround(centre, 3, 200, index + 1));
    const current = [20, 21, 19].map((centre, index) => samplesAround(centre, 3, 200, index + 10));
    expect(compareRuns(baseline, current).map((result) => result.regressed)).toEqual([true, true]);
  });

  it('reads several directories for each side', () => {
    expect(parseArguments(['--baseline', 'a', 'b', '--current', 'c'])).toEqual({
      baseline: ['a', 'b'],
      current: ['c'],
    });
    expect(() => parseArguments(['a', '--current', 'c'])).toThrow(/comes before/u);
    expect(() => parseArguments(['--baseline', 'a'])).toThrow(/at least one/u);
  });
});
