/**
 * The analyses a guided workflow needs before it plans (ADR-0105), run one
 * after another on the detection worker: each member's assistants by the
 * session's detections, each region's loop by its loop analyses, so the
 * Analysis and Loop panels show what the workflow asked and the plan reads
 * what they hold.
 *
 * One at a time, so the worker reads one sound at once and the page describes
 * one sound at once, however many members a group has (G4); a new run stops
 * the one before. A job ends when what it started is no longer running,
 * whether it answered, failed or was stopped elsewhere; the next starts then.
 * Nothing here changes the project.
 */

import { observable, type Observable } from '../state/observable.js';

/** One analysis of a workflow's run. */
export interface WorkflowAnalysisJob {
  /** What the person calls what it analyses. */
  readonly name: string;
  /** Starts it. */
  readonly start: () => void;
  /** Whether it is still running. */
  readonly running: () => boolean;
  /** Stops it while it runs. */
  readonly cancel: () => void;
}

/** Whether a workflow's analyses are running, and how far they have gone. */
export type WorkflowAnalysisState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running';
      /** The jobs ended, and all of them. */
      readonly done: number;
      readonly total: number;
      /** What the job running analyses. */
      readonly current: string;
    };

const IDLE: WorkflowAnalysisState = { kind: 'idle' };

/** A run's jobs, and the one running. */
interface Run {
  readonly jobs: readonly WorkflowAnalysisJob[];
  readonly at: number;
}

/** The workflows' analyses (see the module comment). */
export class WorkflowAnalysing implements Observable<WorkflowAnalysisState> {
  readonly #state = observable<WorkflowAnalysisState>(IDLE);
  #run: Run | undefined;

  readonly get = this.#state.get;
  readonly subscribe = this.#state.subscribe;

  /** Follows `changes`, the stores a job's analysis is kept in, to start each job once the one before ends. */
  constructor(changes: readonly Pick<Observable<unknown>, 'subscribe'>[]) {
    for (const change of changes) {
      change.subscribe(() => {
        this.#advance();
      });
    }
  }

  /** Runs `jobs` in turn, stopping a run still going. */
  run(jobs: readonly WorkflowAnalysisJob[]): void {
    this.cancel();
    if (jobs.length === 0) return;
    this.#begin({ jobs, at: 0 });
  }

  /** Stops the run going, its job running and those after it; answers whether one was. */
  cancel(): boolean {
    const run = this.#run;
    if (run === undefined) return false;
    this.#run = undefined;
    this.#state.set(IDLE);
    const job = run.jobs[run.at];
    if (job?.running() === true) job.cancel();
    return true;
  }

  /** Starts the job at `run.at`, and goes on at once where it ended as it started. */
  #begin(run: Run): void {
    const job = run.jobs[run.at];
    if (job === undefined) {
      this.#run = undefined;
      this.#state.set(IDLE);
      return;
    }
    this.#run = run;
    this.#state.set({ kind: 'running', done: run.at, total: run.jobs.length, current: job.name });
    job.start();
    // A job answered from what the worker kept may end before anything is
    // told of it, and a store told of nothing starts no next job.
    this.#advance();
  }

  /** Starts the next job once the one running has ended. */
  #advance(): void {
    const run = this.#run;
    if (run === undefined) return;
    const job = run.jobs[run.at];
    if (job === undefined || job.running()) return;
    this.#begin({ jobs: run.jobs, at: run.at + 1 });
  }
}
