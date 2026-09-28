/**
 * What one workload costs against another, in the processor time each takes.
 *
 * Not a fixture: nothing here is generated. It is the measure a test of cost
 * holds code to where a time alone would be a number tuned to one machine's
 * speed. Read against a baseline on the same machine at the same moment, the
 * machine's speed cancels out: a text against prose of the same length shows a
 * text that costs many times what prose does, and four times the work against
 * the work shows a cost that grows faster than the work.
 *
 * Measured in the processor time the process spends, and not by the clock: the
 * clock counts the time a reading waits while the machine runs other work, and
 * under many busy processes a reading by the clock can come out five times what
 * the work costs. Processor time does not remove every effect of load, since a
 * core's frequency, its cache and a thread sharing it change what the same work
 * costs from one moment to the next, so the two are read in turn, a block of
 * one and then a block of the other, until each has been read for
 * {@link BUDGET_US} and {@link READINGS} times: a change while they are read
 * falls on both.
 *
 * Counted in readings as well as in time, because a block is at least one
 * reading: a workload whose one reading costs a tenth of a second, read for a
 * quarter of a second alone, is weighed on two or three readings, and one
 * pause of the garbage collector in either decides the ratio.
 */

/**
 * The coarsest step processor time is counted in, in microseconds: the
 * system's clock tick, a sixty-fourth of a second on Windows, which Node
 * reports as fifteen or sixteen milliseconds. A reading counted in such steps
 * comes out as much as a step more or less than it costs.
 */
export const CLOCK_STEP_US = 16_000;

/**
 * The shortest block of readings of one side, in microseconds of processor
 * time: two steps of the clock, so that a step is at most half of what a block
 * is counted as.
 */
export const BLOCK_US = 2 * CLOCK_STEP_US;

/**
 * The processor time, in microseconds, each side is read for at least, of
 * which a step of the clock tick is a small part.
 */
const BUDGET_US = 256_000;

/**
 * The readings each side is weighed on at least, so that a workload whose one
 * reading outlasts a block is not weighed on a handful, where a light one is
 * read thousands of times in its budget.
 */
const READINGS = 32;

/**
 * The processor time, in microseconds, the pairs of blocks already read have
 * cost past which no further pair is read. Each pair reads the baseline for as
 * long as the workload, and each side is read at least {@link READINGS} times,
 * so it is reached only where one reading costs about half a second or more. In
 * the tests of cost only a defect does, and it is weighed on fewer readings,
 * many times its limit, within {@link LONGEST_COST_TEST_MS}.
 */
export const LONGEST_US = 32_000_000;

/**
 * The most processor time, in microseconds, {@link relativeCost} allows one
 * reading of either side: a reading that costs more ends the measure with a
 * failure naming the side, the reading's cost and this, so that
 * {@link LONGEST_COST_TEST_MS}, derived from it, holds of every measure
 * answered. It is about twice the longest reading any proven defect makes on
 * a quiet machine, twelve thousand stored profiles under one identifier, each
 * number counted from two, which load in about 5.8 seconds where the code
 * loads them in milliseconds: a defect's reading under load stays within it,
 * so the defect fails on its ratio.
 */
export const LONGEST_READING_US = 12_000_000;

/**
 * How many times its processor time a test of cost can take by the clock with
 * forty busy processes beside the tests, which counts the time a reading waits
 * for a processor as well as the time it runs.
 */
export const CLOCK_OVER_PROCESSOR = 5;

/**
 * The most processor time, in microseconds, {@link relativeCostWithin} takes
 * given `longest`, where no one reading of either side costs more than
 * `reading`: the first reading of each side; the pairs of blocks read until
 * they have cost `longest`; and one pair more, whose blocks each end with the
 * reading that passes their length, the longer of {@link BLOCK_US} and the
 * longer first reading, so each takes up to a reading more than that length.
 */
export function longestCostUs(longest: number, reading: number): number {
  return 2 * reading + longest + 2 * (Math.max(BLOCK_US, reading) + reading);
}

/**
 * The longest a test of cost takes by the clock, in milliseconds, which is the
 * timeout of each: 520 seconds. That is {@link CLOCK_OVER_PROCESSOR} times what
 * {@link relativeCost} takes where one reading costs
 * {@link LONGEST_READING_US}: the two first readings, 24 seconds;
 * {@link LONGEST_US} of pairs, 32; and a pair past it of two blocks of 24
 * seconds each, 48, which comes to 104 seconds of processor time. The measure
 * enforces it: it refuses a reading that costs more than
 * {@link LONGEST_READING_US}, so a slower defect fails on that reading, which
 * runs to its end once begun, and reads nothing after it.
 */
export const LONGEST_COST_TEST_MS =
  (CLOCK_OVER_PROCESSOR * longestCostUs(LONGEST_US, LONGEST_READING_US)) / 1000;

/** The processor time a process has spent, in microseconds, as Node counts it. */
interface CpuUsage {
  readonly user: number;
  readonly system: number;
}

/**
 * The one part of Node the measure reads, named here by its shape because an
 * entry point is compiled without Node's types, as each package's is, the way
 * the input package reads a browser event. The fixtures run in Vitest alone,
 * which runs every test under Node, in a simulated page or not.
 */
declare const process: {
  cpuUsage(previous?: CpuUsage): CpuUsage;
};

/** One side of a comparison, the name a failure gives it, and what its readings have cost so far. */
interface Side {
  readonly name: 'workload' | 'baseline';
  readonly read: () => unknown;
  spent: number;
  readings: number;
}

/** The processor time, in microseconds, the process has spent since `before`. */
function spentSince(before: CpuUsage): number {
  const { user, system } = process.cpuUsage(before);
  return user + system;
}

/**
 * What {@link relativeCostWithin} reads each side to, and the most it reads:
 * the readings each side is weighed on at least; the processor time, in
 * microseconds, the pairs of blocks read may cost before no further pair is
 * read; and the processor time, in microseconds, one reading may cost.
 */
export interface CostLimits {
  readonly readings: number;
  readonly longest: number;
  readonly longestReading: number;
}

/** Fails the measure where one reading of `side` cost more than `most` microseconds. */
function holdReading(side: Side, reading: number, most: number): void {
  if (reading > most) {
    throw new Error(
      `One reading of the ${side.name} took ${String(reading)} microseconds of processor time, more than ${String(most)}, the most a reading is allowed.`,
    );
  }
}

/**
 * How many times the processor time of one reading of `workload` is that of
 * one reading of `baseline`.
 *
 * Each is read once before it is measured, so no reading pays for what the
 * first compiles or caches. A block lasts at least as long as the longer of
 * those first readings, so a workload whose one reading outlasts a block is
 * weighed in each pair against as long a block of the other, rather than one
 * reading of it against many blocks of the other. A reading of either that
 * costs more than {@link LONGEST_READING_US} ends it with a failure.
 */
export function relativeCost(workload: () => unknown, baseline: () => unknown): number {
  return relativeCostWithin(workload, baseline, {
    readings: READINGS,
    longest: LONGEST_US,
    longestReading: LONGEST_READING_US,
  });
}

/**
 * {@link relativeCost}, each side read at least `readings` times, no further
 * pair of blocks read once those read have cost `longest` microseconds of
 * processor time, and a reading of either side that costs more than
 * `longestReading` refused with a failure naming the side. The first pair is
 * always read.
 */
export function relativeCostWithin(
  workload: () => unknown,
  baseline: () => unknown,
  limits: CostLimits,
): number {
  const { readings, longest, longestReading } = limits;
  const measured: Side = { name: 'workload', read: workload, spent: 0, readings: 0 };
  const against: Side = { name: 'baseline', read: baseline, spent: 0, readings: 0 };

  let block = BLOCK_US;
  for (const side of [measured, against]) {
    const before = process.cpuUsage();
    side.read();
    const reading = spentSince(before);
    holdReading(side, reading, longestReading);
    block = Math.max(block, reading);
  }

  const unread = (side: Side) => side.spent < BUDGET_US || side.readings < readings;
  for (let pair = 0; unread(measured) || unread(against); pair += 1) {
    if (pair > 0 && measured.spent + against.spent >= longest) break;
    for (const side of [measured, against]) {
      const before = process.cpuUsage();
      let spent = 0;
      while (spent < block) {
        side.read();
        side.readings += 1;
        const now = spentSince(before);
        holdReading(side, now - spent, longestReading);
        spent = now;
      }
      side.spent += spent;
    }
  }

  return measured.spent / measured.readings / (against.spent / against.readings);
}
