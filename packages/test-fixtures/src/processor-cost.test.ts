import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  BLOCK_US,
  CLOCK_OVER_PROCESSOR,
  CLOCK_STEP_US,
  LONGEST_COST_TEST_MS,
  LONGEST_READING_US,
  LONGEST_US,
  longestCostUs,
  relativeCost,
  relativeCostWithin,
} from './processor-cost.js';

/**
 * Work in proportion to `units`, whose answer is returned so none is skipped.
 * Each step multiplies in 32 bits, so a step costs the same however many there
 * are, where a product past the range a double holds exactly costs more.
 */
function work(units: number): number {
  let sum = 0;
  for (let step = 0; step < units * 50_000; step += 1) sum = (sum + Math.imul(step, step)) | 0;
  return sum;
}

/** The processor time, in microseconds, the process has spent since `before`. */
function spentSince(before: NodeJS.CpuUsage): number {
  const { user, system } = process.cpuUsage(before);
  return user + system;
}

/** The processor time, in microseconds, one reading of {@link work} in `units` takes. */
function oneReading(units: number): number {
  const before = process.cpuUsage();
  work(units);
  return spentSince(before);
}

/**
 * The least of three readings of {@link work} in `units`, taken after a reading
 * that is not counted, so that none of them pays for the engine compiling the
 * loop for its size.
 */
function warmReading(units: number): number {
  work(units);
  return Math.min(oneReading(units), oneReading(units), oneReading(units));
}

/**
 * Units of {@link work} whose one reading outlasts a block where the test runs,
 * on any machine and engine and beside any other work, grown from one. Each
 * size is judged warm, by the least of its readings, and grown until that is
 * counted past two blocks and a step of the clock: counted so, a reading costs
 * more than two blocks however it falls on the clock's steps, so it still
 * outlasts a block when the processor runs it up to twice as fast while it is
 * measured, as it can once the work beside it ends.
 */
function unitsOutlastingTwoBlocks(): number {
  let units = 1;
  while (warmReading(units) <= 2 * BLOCK_US + CLOCK_STEP_US) units = Math.ceil(units * 1.25);
  return units;
}

/**
 * Keeps the processor busy until the process has spent more than `us`
 * microseconds since it began, so that a reading of it costs more than `us`
 * however the clock counts it.
 */
function spinPast(us: number): number {
  const before = process.cpuUsage();
  let spent = 0;
  while (spent <= us) spent = spentSince(before);
  return spent;
}

/**
 * A side whose reading numbered `heavy` is spun past `most` microseconds and
 * whose every other reading does next to nothing, with the readings made of it
 * so far.
 */
function heavyOn(
  heavy: number,
  most: number,
): { readonly read: () => number; readonly calls: number } {
  let calls = 0;
  return {
    read: () => ((calls += 1) === heavy ? spinPast(most) : 0),
    get calls() {
      return calls;
    },
  };
}

/** One reading of one side of a comparison, and its processor time in microseconds. */
interface Reading {
  readonly side: 'workload' | 'baseline';
  readonly spent: number;
}

/**
 * Each reading `compare` makes of {@link work}, in `workload` units on the one
 * side and `baseline` units on the other, in order, the first of each among
 * them.
 */
function readingsOf(
  compare: (workload: () => unknown, baseline: () => unknown) => unknown,
  workload: number,
  baseline: number,
): Reading[] {
  const readings: Reading[] = [];
  const reading = (side: Reading['side'], units: number) => () => {
    const before = process.cpuUsage();
    const answer = work(units);
    readings.push({ side, spent: spentSince(before) });
    return answer;
  };
  compare(reading('workload', workload), reading('baseline', baseline));
  return readings;
}

/** Limits that read one pair of blocks alone, and allow a reading what a test of cost does. */
const ONE_PAIR = { readings: 32, longest: 0, longestReading: LONGEST_READING_US };

describe('the cost of one workload against another', () => {
  it(
    'reads four times the work as about four times the cost, and the same work as the same',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // Bounds by ratio, as far from four and from one as a busy machine moves
      // a reading, and each twice as close to its own answer as to the other's.
      const fourfold = relativeCost(
        () => work(4),
        () => work(1),
      );
      const same = relativeCost(
        () => work(1),
        () => work(1),
      );

      expect(fourfold).toBeGreaterThan(2);
      expect(fourfold).toBeLessThan(8);
      expect(same).toBeGreaterThan(0.5);
      expect(same).toBeLessThan(2);
    },
  );

  it(
    'reads each side once before it is measured, and then the two in turn, in blocks',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      const read: string[] = [];
      relativeCost(
        () => {
          read.push('workload');
          return work(1);
        },
        () => {
          read.push('baseline');
          return work(1);
        },
      );

      expect(read.slice(0, 2)).toEqual(['workload', 'baseline']);

      // A block is a run of one side's readings; one side read whole and then
      // the other would give two, and a change in the machine's speed between
      // them would fall on one side alone.
      const blocks = read.slice(2).filter((side, at, all) => side !== all[at - 1]);
      expect(blocks.length).toBeGreaterThanOrEqual(4);
      expect(
        blocks.filter((side, at) => side !== (at % 2 === 0 ? 'workload' : 'baseline')),
      ).toEqual([]);
    },
  );

  it(
    'reads each side at least thirty-two times, where one reading of either outlasts a block',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // Read for a quarter of a second alone, a workload costing a tenth of a
      // second a reading would be weighed on two or three readings, and one
      // pause of the garbage collector in either would decide the ratio. Each
      // side is such a workload here, grown until it is where the test runs,
      // and every reading of either is seen to outlast a block. A reading that
      // does is counted past a block less a step of the clock, however it falls
      // on the clock's steps, so that is what each is held to.
      const units = unitsOutlastingTwoBlocks();
      const readings = readingsOf(relativeCost, units, units);
      const sides = readings.slice(2).map((reading) => reading.side);

      expect(readings.reduce((least, one) => Math.min(least, one.spent), Infinity)).toBeGreaterThan(
        BLOCK_US - CLOCK_STEP_US,
      );
      expect(sides.filter((side) => side === 'workload').length).toBeGreaterThanOrEqual(32);
      expect(sides.filter((side) => side === 'baseline').length).toBeGreaterThanOrEqual(32);
    },
  );

  it(
    'reads no pair of blocks past the first once those read have cost the longest it is given',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      const within = (workload: () => unknown, baseline: () => unknown) =>
        relativeCostWithin(workload, baseline, ONE_PAIR);
      const blocks = readingsOf(within, 1, 1)
        .slice(2)
        .map((reading) => reading.side)
        .filter((side, at, all) => side !== all[at - 1]);

      expect(blocks).toEqual(['workload', 'baseline']);
    },
  );

  it(
    'refuses a reading of either side that costs more than the most a reading is allowed, naming it',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // The processor time of the process counts each of its threads, and each
      // thread running at a tick of the clock is counted a step. A reading that
      // does next to nothing spans a tick at most, so it is counted at most a
      // step for each processor, and one spun past that costs more however the
      // clock counts it. A side's first reading is read before it is measured
      // and its second is its first in a block, so a reading is refused in
      // either place, and nothing is read after it.
      const most = availableParallelism() * CLOCK_STEP_US;
      const limits = { readings: 32, longest: LONGEST_US, longestReading: most };
      const refused = (side: string) =>
        new RegExp(
          String.raw`^One reading of the ${side} took \d+ microseconds of processor time, more than ${String(most)}, the most a reading is allowed\.$`,
        );

      for (const heavy of [1, 2]) {
        const workload = heavyOn(heavy, most);
        expect(() => relativeCostWithin(workload.read, () => 0, limits)).toThrow(
          refused('workload'),
        );
        expect(workload.calls).toBe(heavy);

        const baseline = heavyOn(heavy, most);
        expect(() => relativeCostWithin(() => 0, baseline.read, limits)).toThrow(
          refused('baseline'),
        );
        expect(baseline.calls).toBe(heavy);
      }
      expect(
        relativeCostWithin(
          () => 0,
          () => 0,
          { ...limits, longest: 0 },
        ),
      ).toBeGreaterThan(0);
    },
  );

  it(
    'takes no more processor time than its first readings, the pairs read to the cap and one pair past it',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // Given no time at all, the first pair is read and is the pair past the
      // cap. Each of its blocks ends with the reading that passes the block's
      // length, so it can take a reading more than a block on each side, which
      // the longest a test of cost is allowed is derived from.
      const units = unitsOutlastingTwoBlocks();
      const before = process.cpuUsage();
      const readings = readingsOf(
        (workload, baseline) => relativeCostWithin(workload, baseline, ONE_PAIR),
        units,
        1,
      );
      const spent = spentSince(before);
      const longestReading = readings.reduce((most, one) => Math.max(most, one.spent), 0);

      expect(spent).toBeLessThanOrEqual(longestCostUs(0, longestReading));
    },
  );

  it('allows a test of cost, by the clock under load, what the cap, the first readings and a pair past the cap take', () => {
    expect(LONGEST_COST_TEST_MS).toBeGreaterThanOrEqual(
      (CLOCK_OVER_PROCESSOR * longestCostUs(LONGEST_US, LONGEST_READING_US)) / 1000,
    );
  });
});
