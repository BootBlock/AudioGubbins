/**
 * Foreground and background processing priority (REQ-ARCH-084).
 *
 * Every job the engine runs off the audio thread, a preview render or a peak
 * file alike, goes through one bounded queue, so the machine is never asked to
 * do more at once than it was sized for. By default interactive work comes
 * first: a foreground job always starts before a waiting background one, and
 * while interactive work is active background jobs are held to a smaller
 * share. A person who wants a batch finished and is not playing can choose the
 * throughput policy instead.
 *
 * Nothing here reads a clock or sets a timer. A job starts when a slot frees or
 * the rules change, so a test drives the queue step by step and sees the same
 * order every time.
 */

import { fail, failure, FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';

import { Cancelled, createCancellationSource, type CancellationSignal } from '../cancellation.js';

/** Whether a job is interactive work or background work. */
export const JobPriority = {
  /** Work a person is waiting on: a preview, a render they asked for. */
  Foreground: 'foreground',
  /** Work nobody is waiting on yet: analysis, peaks, spectrograms, caches, batches. */
  Background: 'background',
} as const;

/** Whether a job is interactive work or background work. */
export type JobPriority = (typeof JobPriority)[keyof typeof JobPriority];

/** How the queue shares its slots between the two priorities. */
export const SchedulingPolicy = {
  /**
   * Foreground jobs start first, and background jobs are held to their share
   * while interactive work is active. The default.
   */
  InteractiveFirst: 'interactive-first',
  /** Jobs start in the order they were submitted, and background may take every slot. */
  Throughput: 'throughput',
} as const;

/** How the queue shares its slots between the two priorities. */
export type SchedulingPolicy = (typeof SchedulingPolicy)[keyof typeof SchedulingPolicy];

/** A piece of work and its priority. `run` receives the caller's cancellation. */
export interface ScheduledJob<T> {
  readonly priority: JobPriority;
  readonly run: (signal: CancellationSignal) => Promise<T>;
}

/** How many jobs are running and waiting, for diagnostics. */
export interface SchedulerCounts {
  readonly running: Readonly<Record<JobPriority, number>>;
  readonly queued: Readonly<Record<JobPriority, number>>;
}

/** How the scheduler starts. */
export interface PrioritySchedulerOptions {
  /** The most jobs that run at once, of either priority. */
  readonly concurrency: number;
  readonly policy?: SchedulingPolicy;
  /** The most background jobs that run at once while interactive work is active. */
  readonly backgroundConcurrencyWhileInteractive: number;
}

/** A bounded queue of prioritised jobs. */
export interface PriorityScheduler {
  /**
   * Queues a job and settles as it does. Cancelling `signal` before the job
   * starts removes it and rejects; after, the job's own `run` hears it.
   */
  submit<T>(job: ScheduledJob<T>, signal?: CancellationSignal): Promise<T>;
  /** Whether a person is playing or editing. */
  setInteractive(active: boolean): void;
  setPolicy(policy: SchedulingPolicy): void;
  /** Follows a change of performance profile. */
  setBackgroundConcurrencyWhileInteractive(limit: number): DomainResult<void>;
  readonly counts: SchedulerCounts;
}

interface Pending {
  readonly priority: JobPriority;
  /** Submission order, across both priorities, for the throughput policy. */
  readonly sequence: number;
  readonly start: () => void;
}

interface SchedulerState {
  readonly concurrency: number;
  policy: SchedulingPolicy;
  backgroundLimit: number;
  interactive: boolean;
  nextSequence: number;
  /** A `Set` keeps submission order and removes a cancelled job in constant time. */
  readonly queued: Readonly<Record<JobPriority, Set<Pending>>>;
  readonly running: Record<JobPriority, number>;
}

function slotCount(value: number, what: string, code: string): DomainResult<number> {
  if (Number.isSafeInteger(value) && value >= 1) return succeed(value);
  return fail(
    failure(
      code,
      FailureKind.Rejected,
      `${what} must be a whole number of at least one; ${String(value)} was given.`,
    ),
  );
}

function backgroundLimitOf(limit: number): DomainResult<number> {
  return slotCount(
    limit,
    'The background concurrency while interactive',
    'priority-scheduler.background-limit-invalid',
  );
}

function oldest(state: SchedulerState, priority: JobPriority): Pending | undefined {
  return state.queued[priority].values().next().value;
}

/**
 * Interactive work is active while a person is playing or editing, or while
 * any foreground job, which someone is by definition waiting on, is running
 * or queued.
 */
function interactiveActive(state: SchedulerState): boolean {
  return state.interactive || state.running.foreground > 0 || state.queued.foreground.size > 0;
}

function nextToStart(state: SchedulerState): Pending | undefined {
  const foreground = oldest(state, JobPriority.Foreground);
  const background = oldest(state, JobPriority.Background);
  if (state.policy === SchedulingPolicy.Throughput) {
    if (foreground === undefined || background === undefined) return foreground ?? background;
    return foreground.sequence < background.sequence ? foreground : background;
  }
  if (foreground !== undefined) return foreground;
  const heldBack = interactiveActive(state) && state.running.background >= state.backgroundLimit;
  return heldBack ? undefined : background;
}

/** Starts jobs until the slots are full or the rules hold the rest back. */
function fillSlots(state: SchedulerState): void {
  while (state.running.foreground + state.running.background < state.concurrency) {
    const next = nextToStart(state);
    if (next === undefined) return;
    state.queued[next.priority].delete(next);
    state.running[next.priority] += 1;
    next.start();
  }
}

function reasonOf(signal: CancellationSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Cancelled();
}

/**
 * Runs a job whose slot is already counted, and frees the slot as it settles.
 * Resolving through a new promise turns a `run` that throws before returning
 * into a rejection, like one that rejects.
 */
function launch<T>(
  state: SchedulerState,
  job: ScheduledJob<T>,
  signal: CancellationSignal | undefined,
): Promise<T> {
  // A job without a caller's signal still receives one; nothing cancels it.
  const own = signal ?? createCancellationSource().signal;
  const outcome = new Promise<T>((settle) => {
    settle(job.run(own));
  });
  return outcome.finally(() => {
    state.running[job.priority] -= 1;
    fillSlots(state);
  });
}

function submitTo<T>(
  state: SchedulerState,
  job: ScheduledJob<T>,
  signal: CancellationSignal | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(reasonOf(signal));
      return;
    }
    const queue = state.queued[job.priority];
    const pending: Pending = {
      priority: job.priority,
      sequence: state.nextSequence++,
      start: () => {
        signal?.removeEventListener('abort', withdraw);
        resolve(launch(state, job, signal));
      },
    };
    function withdraw(): void {
      if (signal === undefined || !queue.delete(pending)) return;
      // Withdrawing starts nothing else: a foreground job waits only while
      // every slot is taken, and a waiting background job holds no slot or
      // share.
      reject(reasonOf(signal));
    }
    signal?.addEventListener('abort', withdraw, { once: true });
    queue.add(pending);
    fillSlots(state);
  });
}

function schedulerOver(state: SchedulerState): PriorityScheduler {
  return {
    submit: (job, signal) => submitTo(state, job, signal),
    setInteractive: (active) => {
      state.interactive = active;
      fillSlots(state);
    },
    setPolicy: (policy) => {
      state.policy = policy;
      fillSlots(state);
    },
    setBackgroundConcurrencyWhileInteractive: (limit) => {
      const checked = backgroundLimitOf(limit);
      if (!checked.ok) return checked;
      state.backgroundLimit = checked.value;
      fillSlots(state);
      return succeed(undefined);
    },
    get counts() {
      return {
        running: { ...state.running },
        queued: {
          foreground: state.queued.foreground.size,
          background: state.queued.background.size,
        },
      };
    },
  };
}

/** A scheduler with no jobs yet, under the given limits. */
export function createPriorityScheduler(
  options: PrioritySchedulerOptions,
): DomainResult<PriorityScheduler> {
  const concurrency = slotCount(
    options.concurrency,
    'The concurrency',
    'priority-scheduler.concurrency-invalid',
  );
  const backgroundLimit = backgroundLimitOf(options.backgroundConcurrencyWhileInteractive);
  if (!concurrency.ok) {
    return backgroundLimit.ok
      ? concurrency
      : fail(
          concurrency.failures[0],
          ...concurrency.failures.slice(1),
          ...backgroundLimit.failures,
        );
  }
  if (!backgroundLimit.ok) return backgroundLimit;
  return succeed(
    schedulerOver({
      concurrency: concurrency.value,
      policy: options.policy ?? SchedulingPolicy.InteractiveFirst,
      backgroundLimit: backgroundLimit.value,
      interactive: false,
      nextSequence: 0,
      queued: { foreground: new Set(), background: new Set() },
      running: { foreground: 0, background: 0 },
    }),
  );
}
