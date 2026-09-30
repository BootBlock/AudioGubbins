/**
 * The runs a building pyramid finishes, sent to the page in batches.
 *
 * A chunk finishes a run at every level it completes, and a long source has
 * thousands of chunks, so a message per chunk would have the page apply and
 * redraw faster than it can show. Runs are held and sent at most once a display
 * frame, each job's merged where they touch, so a batch is a few buffers
 * whatever the number of chunks in it. What is held is sent whenever the worker
 * stops building, and before the job's pyramid is finished, so a run is never
 * left behind.
 */

import { copyBuckets, packedChannels, type PeakRun } from './peak-pyramid.js';

/** The fewest milliseconds between two batches: a display frame at 60 Hz. */
const BATCH_INTERVAL_MS = 16;

function bucketsIn(run: PeakRun): number {
  return run.channels[0]?.minimum.length ?? 0;
}

/** `first` and the runs that follow on from it at its level, as one run in one buffer. */
function joined(first: PeakRun, rest: readonly PeakRun[]): PeakRun {
  if (rest.length === 0) return first;
  const all = [first, ...rest];
  const channels = packedChannels(
    first.channels.length,
    all.reduce((sum, run) => sum + bucketsIn(run), 0),
  );
  let at = 0;
  for (const run of all) {
    const count = bucketsIn(run);
    run.channels.forEach((values, index) => {
      const into = channels[index];
      if (into !== undefined) copyBuckets(values, 0, count, into, at);
    });
    at += count;
  }
  return { level: first.level, first: first.first, channels };
}

/** `runs` in order of level and position, each set that touches at one level made one run. */
function mergedRuns(runs: readonly PeakRun[]): readonly PeakRun[] {
  const ordered = runs.toSorted((one, other) => one.level - other.level || one.first - other.first);
  const merged: PeakRun[] = [];
  let first: PeakRun | undefined;
  let rest: PeakRun[] = [];
  let end = 0;
  for (const run of ordered) {
    if (run.level === first?.level && run.first === end) {
      rest.push(run);
    } else {
      if (first !== undefined) merged.push(joined(first, rest));
      first = run;
      rest = [];
    }
    end = run.first + bucketsIn(run);
  }
  if (first !== undefined) merged.push(joined(first, rest));
  return merged;
}

/** Runs held per job until their batch is due. */
export class RunBatches {
  readonly #send: (job: string, runs: readonly PeakRun[]) => void;
  readonly #now: () => number;
  readonly #held = new Map<string, PeakRun[]>();
  #sentAt = -Infinity;

  constructor(send: (job: string, runs: readonly PeakRun[]) => void, now: () => number) {
    this.#send = send;
    this.#now = now;
  }

  /** Holds `runs` of job `job`, and sends every job's held runs if a batch is due. */
  add(job: string, runs: readonly PeakRun[]): void {
    const held = this.#held.get(job);
    if (held === undefined) this.#held.set(job, [...runs]);
    else held.push(...runs);
    if (this.#now() - this.#sentAt >= BATCH_INTERVAL_MS) this.flushAll();
  }

  /** Sends job `job`'s held runs now. */
  flush(job: string): void {
    const held = this.#held.get(job);
    this.#held.delete(job);
    if (held !== undefined && held.length > 0) this.#send(job, mergedRuns(held));
  }

  /** Sends every job's held runs now. */
  flushAll(): void {
    for (const job of [...this.#held.keys()]) this.flush(job);
    this.#sentAt = this.#now();
  }

  /** Forgets job `job`'s held runs, which no page waits on. */
  drop(job: string): void {
    this.#held.delete(job);
  }
}
