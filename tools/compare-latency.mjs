#!/usr/bin/env node
/**
 * Compares two runs of the editing-latency suite, and refuses a regression.
 *
 * `tests/e2e/latency/interaction-latency.spec.ts` writes one file of samples
 * for each interaction it measures. Run once before the Phase 16 redesign and
 * once after, the two are compared here, interaction by interaction.
 *
 * Latency on a shared machine varies from run to run, so a fixed threshold
 * would fail on load and pass a real regression on a quiet day (REQ-REPO-189).
 * The comparison is statistical instead. Each side is one or more runs, each a
 * directory of the suite's files, taken on separate occasions. Two runs of the
 * same code differ by more than the samples inside one run suggest, because a
 * run's whole distribution moves with the machine's load, so the resampling is
 * hierarchical: each resample draws runs with replacement, then samples with
 * replacement inside each run drawn, and takes the statistic of what it drew.
 * For the median and the 90th percentile of each interaction, the differences
 * between the two sides' resampled statistics give a 95 per cent interval,
 * their 2.5th to 97.5th percentiles. A statistic has regressed when the whole
 * interval lies above its tolerance: the larger of an absolute floor and a
 * share of the baseline's value, so neither a fraction of a millisecond on a
 * fast interaction nor a frame's quantisation counts as a regression. The
 * phase's evidence takes three runs a side; one run a side cannot see the
 * variation between runs at all.
 *
 * Usage:
 *
 * ```
 * node tools/compare-latency.mjs --baseline <dir> [<dir>…]
 *   --current <dir> [<dir>…]
 * ```
 *
 * It prints a table of each interaction's statistics and intervals, and exits
 * with 1 when any statistic has regressed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A statistic compared, and its tolerance: a regression must exceed both
 * `floorMs` and `share` of the baseline's value.
 *
 * @typedef {object} Statistic
 * @property {string} name
 * @property {number} quantile
 * @property {number} floorMs
 * @property {number} share
 */

/** @type {readonly Statistic[]} */
export const STATISTICS = [
  { name: 'median', quantile: 0.5, floorMs: 2, share: 0.1 },
  { name: 'p90', quantile: 0.9, floorMs: 4, share: 0.15 },
];

/** Resamples drawn for each interval. */
export const RESAMPLES = 2000;

/**
 * The `q` quantile of `sorted`, ascending, by linear interpolation between
 * the two nearest ranks.
 *
 * @param {readonly number[]} sorted
 * @param {number} q
 * @returns {number}
 */
export function quantile(sorted, q) {
  if (sorted.length === 0) throw new RangeError('A quantile of no samples is undefined.');
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  const lower = sorted[below] ?? Number.NaN;
  const upper = sorted[above] ?? Number.NaN;
  return lower + (upper - lower) * (position - below);
}

/**
 * A generator of uniform numbers in [0, 1), seeded, so a comparison of the same
 * two runs always gives the same interval.
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    // Mulberry32.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One of `items`, drawn uniformly.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {() => number} random
 * @returns {T}
 */
function draw(items, random) {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new RangeError('Nothing to draw from.');
  return item;
}

/**
 * The `q` quantile of a hierarchical resample of `runs`: as many runs as there
 * are, drawn with replacement, and inside each, as many samples as it has.
 *
 * @param {readonly (readonly number[])[]} runs
 * @param {number} q
 * @param {() => number} random
 * @returns {number}
 */
function resampledQuantile(runs, q, random) {
  const drawn = runs
    .map(() => draw(runs, random))
    .flatMap((run) => run.map(() => draw(run, random)));
  return quantile(
    drawn.sort((a, b) => a - b),
    q,
  );
}

/**
 * @typedef {object} StatisticComparison
 * @property {string} name
 * @property {number} baseline The statistic of the baseline, in milliseconds.
 * @property {number} current The statistic of the current run, in milliseconds.
 * @property {number} low The interval's lower bound on the difference.
 * @property {number} high The interval's upper bound on the difference.
 * @property {number} tolerance The difference a regression must exceed.
 * @property {boolean} regressed Whether all the interval is past the tolerance.
 */

/**
 * Compares the runs of one interaction, each run its samples in milliseconds.
 *
 * @param {readonly (readonly number[])[]} baseline
 * @param {readonly (readonly number[])[]} current
 * @param {number} [seed]
 * @returns {StatisticComparison[]}
 */
export function compareRuns(baseline, current, seed = 1) {
  const random = seededRandom(seed);
  const sortedBaseline = baseline.flat().sort((a, b) => a - b);
  const sortedCurrent = current.flat().sort((a, b) => a - b);
  return STATISTICS.map(({ name, quantile: q, floorMs, share }) => {
    const differences = Array.from(
      { length: RESAMPLES },
      () => resampledQuantile(current, q, random) - resampledQuantile(baseline, q, random),
    ).sort((a, b) => a - b);
    const baselineValue = quantile(sortedBaseline, q);
    const low = quantile(differences, 0.025);
    const tolerance = Math.max(floorMs, share * baselineValue);
    return {
      name,
      baseline: baselineValue,
      current: quantile(sortedCurrent, q),
      low,
      high: quantile(differences, 0.975),
      tolerance,
      regressed: low > tolerance,
    };
  });
}

/**
 * The runs of each interaction in `directories`, one run to a directory.
 *
 * @param {readonly string[]} directories
 * @returns {Map<string, number[][]>}
 */
export function readRuns(directories) {
  /** @type {Map<string, number[][]>} */
  const runs = new Map();
  for (const directory of directories) {
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
      /** @type {{ interaction: string; samples: number[] }} */
      const record = JSON.parse(readFileSync(join(directory, file), 'utf8'));
      runs.set(record.interaction, [...(runs.get(record.interaction) ?? []), record.samples]);
    }
  }
  return runs;
}

/**
 * The directories each flag names, in the order given.
 *
 * @param {readonly string[]} argv
 * @returns {{ baseline: string[]; current: string[] }}
 */
export function parseArguments(argv) {
  /** @type {{ baseline: string[]; current: string[] }} */
  const sides = { baseline: [], current: [] };
  /** @type {'baseline' | 'current' | undefined} */
  let side;
  for (const argument of argv) {
    if (argument === '--baseline' || argument === '--current')
      side = argument === '--baseline' ? 'baseline' : 'current';
    else if (side === undefined)
      throw new Error(`"${argument}" comes before --baseline or --current.`);
    else sides[side].push(argument);
  }
  if (sides.baseline.length === 0 || sides.current.length === 0) {
    throw new Error('Name at least one directory after each of --baseline and --current.');
  }
  return sides;
}

/** @param {number} value */
const ms = (value) => `${value.toFixed(1)} ms`;

function main() {
  const { baseline, current } = parseArguments(process.argv.slice(2));
  const before = readRuns(baseline);
  const after = readRuns(current);
  let regressed = false;
  for (const [interaction, runs] of before) {
    const now = after.get(interaction);
    if (now === undefined) {
      console.log(`${interaction}: no current samples`);
      regressed = true;
      continue;
    }
    for (const result of compareRuns(runs, now)) {
      regressed ||= result.regressed;
      console.log(
        `${interaction} ${result.name}: ${ms(result.baseline)} -> ${ms(result.current)}, ` +
          `difference ${ms(result.low)} to ${ms(result.high)} (95 %), ` +
          `tolerance ${ms(result.tolerance)}: ${result.regressed ? 'REGRESSED' : 'within tolerance'}`,
      );
    }
  }
  process.exitCode = regressed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
