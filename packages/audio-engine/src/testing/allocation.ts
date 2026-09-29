/**
 * How much a run of the engine's code allocates, for the tests that hold the
 * audio thread's code to allocating nothing.
 *
 * A collection on the audio thread pauses the quantum that triggered it, and
 * an allocation per sample or per call is not an error the output shows:
 * only measuring what the heap gained finds it.
 *
 * How it is measured, and why this way. Each new object is bump-allocated in
 * V8's young generation, so the bytes in use there, read before and after a
 * run of quanta, differ by exactly what the run allocated, as long as no
 * collection ran between the reads: `GCProfiler` says whether one did, and
 * such a trial is discarded. Both reads are of this thread's own isolate, so
 * other processes and other test workers on a busy machine cannot move them.
 * Three other measures were tried and refused. The isolate's
 * `total_allocated_bytes` advances only when an allocation buffer is retired,
 * so it moves in steps of hundreds of kilobytes whatever the code does. The
 * old generation's sizes shrink at any moment as the concurrent sweeper runs.
 * Counting collections, or timing, over a long run depends on heap limits and
 * machine load. The reading itself allocates a few objects, the same in every
 * trial, which the baseline of an empty run removes.
 *
 * A run is warmed first, so what runs is the optimised code the audio thread
 * runs once it is warm. On a loaded machine the optimiser can finish late,
 * after the code meets a branch its first compilation never saw, and code
 * awaiting it allocates a little: so warming and measuring repeat, up to
 * {@link ROUNDS} times, until a round finds nothing. An allocation in the
 * code itself is in every round, and still fails.
 */

import { GCProfiler, getHeapSpaceStatistics } from 'node:v8';

/** Quanta in one measured trial: a kernel allocating even 8 bytes a quantum shows 8 KiB. */
export const QUANTA = 1024;

/** Quanta run before measuring, so each path is compiled and settled first. */
const WARM_QUANTA = 4096;

/** Trials measured, of which the least is taken, and those a collection interrupted dropped. */
const TRIALS = 8;

/** The most rounds of warming and measuring before a run's allocation is taken as its own. */
const ROUNDS = 16;

/** The spaces of V8's young generation, where every small new object is placed. */
const YOUNG_SPACES: ReadonlySet<string> = new Set(['new_space', 'new_large_object_space']);

function youngBytes(): number {
  let bytes = 0;
  for (const space of getHeapSpaceStatistics()) {
    if (YOUNG_SPACES.has(space.space_name)) bytes += space.space_used_size;
  }
  return bytes;
}

/** What one measured run does: `prepare` outside the measurement, then `quanta` calls of `quantum`. */
export interface Run {
  readonly prepare?: () => void;
  readonly quantum: () => void;
  readonly quanta?: number;
}

/**
 * The fewest bytes one trial of a run allocated, over the trials no
 * collection interrupted, or `undefined` when a collection interrupted every
 * one, which only allocating can cause.
 */
function leastAllocated({ prepare, quantum, quanta = QUANTA }: Run): number | undefined {
  let least: number | undefined;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    prepare?.();
    const profiler = new GCProfiler();
    profiler.start();
    const before = youngBytes();
    for (let count = 0; count < quanta; count += 1) quantum();
    const after = youngBytes();
    const collections = profiler.stop().statistics.length;
    if (collections === 0 && (least === undefined || after - before < least)) {
      least = after - before;
    }
  }
  return least;
}

/**
 * The fewest bytes a run allocated beyond an empty run's in a round, warmed
 * first, over rounds that stop at the first to reach less than a byte a
 * quantum.
 */
export function allocatedBy(run: Run): number {
  const quanta = run.quanta ?? QUANTA;
  let least = Number.POSITIVE_INFINITY;
  for (let round = 0; round < ROUNDS && least >= quanta; round += 1) {
    for (let count = 0; count < WARM_QUANTA; count += 1) {
      if (count % quanta === 0) run.prepare?.();
      run.quantum();
    }
    const baseline = leastAllocated({ quantum: () => undefined, quanta });
    const measured = leastAllocated(run);
    if (baseline === undefined) throw new Error('A collection interrupted every empty trial.');
    if (measured !== undefined) least = Math.min(least, measured - baseline);
  }
  return least;
}
