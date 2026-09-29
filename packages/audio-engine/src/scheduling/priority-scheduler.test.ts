import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { Cancelled, createCancellationSource, type CancellationSignal } from '../cancellation.js';
import {
  JobPriority,
  SchedulingPolicy,
  createPriorityScheduler,
  type PriorityScheduler,
  type PrioritySchedulerOptions,
} from './priority-scheduler.js';

/** A job the test finishes by hand, recording when it started and what it was given. */
interface Controlled {
  readonly name: string;
  readonly priority: JobPriority;
  started: boolean;
  signal?: CancellationSignal;
  finish(value?: string): void;
  failWith(error: Error): void;
  readonly outcome: Promise<string>;
}

/**
 * Lets the promise reactions a settled job queues run: its slot is freed and
 * the next job started a few microtasks after it settles. Microtasks rather
 * than a timer, so the test reads no clock of the host's.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

function schedulerWith(options: Partial<PrioritySchedulerOptions> = {}): PriorityScheduler {
  return expectSuccess(
    createPriorityScheduler({
      concurrency: 3,
      backgroundConcurrencyWhileInteractive: 1,
      ...options,
    }),
  );
}

function submit(
  scheduler: PriorityScheduler,
  name: string,
  priority: JobPriority,
  order: string[] = [],
  signal?: CancellationSignal,
): Controlled {
  let finish: (value: string) => void = () => undefined;
  let failWith: (error: Error) => void = () => undefined;
  const work = new Promise<string>((resolve, reject) => {
    finish = resolve;
    failWith = reject;
  });
  const job: Omit<Controlled, 'outcome'> = {
    name,
    priority,
    started: false,
    finish: (value = name) => {
      finish(value);
    },
    failWith: (error) => {
      failWith(error);
    },
  };
  const outcome = scheduler.submit(
    {
      priority,
      run: (given) => {
        job.started = true;
        job.signal = given;
        order.push(name);
        return work;
      },
    },
    signal,
  );
  // The tests assert on outcomes they care about; the rest must not be reported as unhandled.
  outcome.catch(() => undefined);
  return Object.assign(job, { outcome });
}

const { Foreground, Background } = JobPriority;

describe('creating a scheduler', () => {
  it.each([0, -1, 1.5, Number.NaN])('refuses a concurrency of %s', (concurrency) => {
    expect(
      expectFailureCode(
        createPriorityScheduler({ concurrency, backgroundConcurrencyWhileInteractive: 1 }),
      ),
    ).toBe('priority-scheduler.concurrency-invalid');
  });

  it.each([0, 2.5])('refuses a background concurrency of %s', (limit) => {
    expect(
      expectFailureCode(
        createPriorityScheduler({ concurrency: 2, backgroundConcurrencyWhileInteractive: limit }),
      ),
    ).toBe('priority-scheduler.background-limit-invalid');
  });

  it('reports both problems at once', () => {
    const result = createPriorityScheduler({
      concurrency: 0,
      backgroundConcurrencyWhileInteractive: 0,
    });
    expect(result.ok ? [] : result.failures.map((problem) => problem.code)).toEqual([
      'priority-scheduler.concurrency-invalid',
      'priority-scheduler.background-limit-invalid',
    ]);
  });

  it('starts idle', () => {
    expect(schedulerWith().counts).toEqual({
      running: { foreground: 0, background: 0 },
      queued: { foreground: 0, background: 0 },
    });
  });
});

describe('bounded concurrency', () => {
  it('never runs more jobs than its concurrency, and starts the next as one finishes', async () => {
    const scheduler = schedulerWith({ concurrency: 2 });
    const jobs = ['a', 'b', 'c', 'd'].map((name) => submit(scheduler, name, Foreground));
    expect(jobs.map((job) => job.started)).toEqual([true, true, false, false]);
    expect(scheduler.counts.queued.foreground).toBe(2);
    jobs[0]!.finish();
    await expect(jobs[0]!.outcome).resolves.toBe('a');
    await settle();
    expect(jobs.map((job) => job.started)).toEqual([true, true, true, false]);
    expect(scheduler.counts.running.foreground).toBe(2);
  });

  it('frees the slot of a job that fails, and passes its failure on', async () => {
    const scheduler = schedulerWith({ concurrency: 1 });
    const first = submit(scheduler, 'first', Background);
    const second = submit(scheduler, 'second', Background);
    const broken = new Error('decoder failed');
    first.failWith(broken);
    await expect(first.outcome).rejects.toBe(broken);
    await settle();
    expect(second.started).toBe(true);
  });

  it('treats a job that throws before returning as one that failed', async () => {
    const scheduler = schedulerWith({ concurrency: 1 });
    const broken = new Error('thrown synchronously');
    const outcome = scheduler.submit({
      priority: Foreground,
      run: () => {
        throw broken;
      },
    });
    await expect(outcome).rejects.toBe(broken);
    await settle();
    expect(scheduler.counts.running.foreground).toBe(0);
  });

  it('runs each priority first in, first out', async () => {
    const order: string[] = [];
    const scheduler = schedulerWith({ concurrency: 1 });
    const jobs = ['one', 'two', 'three'].map((name) => submit(scheduler, name, Background, order));
    for (const job of jobs) {
      job.finish();
      await settle();
    }
    expect(order).toEqual(['one', 'two', 'three']);
  });
});

describe('the interactive-first policy', () => {
  it('starts a waiting foreground job before a waiting background one', async () => {
    const order: string[] = [];
    const scheduler = schedulerWith({ concurrency: 1, backgroundConcurrencyWhileInteractive: 1 });
    const blocker = submit(scheduler, 'blocker', Background, order);
    submit(scheduler, 'background', Background, order);
    submit(scheduler, 'foreground', Foreground, order);
    blocker.finish();
    await settle();
    expect(order).toEqual(['blocker', 'foreground']);
  });

  it('holds background to its share while a person is playing', () => {
    const scheduler = schedulerWith({ concurrency: 4, backgroundConcurrencyWhileInteractive: 1 });
    scheduler.setInteractive(true);
    const jobs = ['a', 'b', 'c'].map((name) => submit(scheduler, name, Background));
    expect(jobs.map((job) => job.started)).toEqual([true, false, false]);
    expect(scheduler.counts).toEqual({
      running: { foreground: 0, background: 1 },
      queued: { foreground: 0, background: 2 },
    });
  });

  it('holds background to its share while a foreground job runs', () => {
    const scheduler = schedulerWith({ concurrency: 4, backgroundConcurrencyWhileInteractive: 2 });
    submit(scheduler, 'preview', Foreground);
    const jobs = ['a', 'b', 'c'].map((name) => submit(scheduler, name, Background));
    expect(jobs.map((job) => job.started)).toEqual([true, true, false]);
  });

  it('gives background every slot once interactive work ends', async () => {
    const scheduler = schedulerWith({ concurrency: 3, backgroundConcurrencyWhileInteractive: 1 });
    scheduler.setInteractive(true);
    const jobs = ['a', 'b', 'c', 'd'].map((name) => submit(scheduler, name, Background));
    scheduler.setInteractive(false);
    expect(jobs.map((job) => job.started)).toEqual([true, true, true, false]);
    const preview = submit(scheduler, 'preview', Foreground);
    jobs[0]!.finish();
    await settle();
    // The freed slot goes to the waiting foreground job, not the fourth background one.
    expect(preview.started).toBe(true);
    expect(jobs[3]!.started).toBe(false);
  });

  it('follows a change of background share', () => {
    const scheduler = schedulerWith({ concurrency: 4, backgroundConcurrencyWhileInteractive: 1 });
    scheduler.setInteractive(true);
    const jobs = ['a', 'b', 'c'].map((name) => submit(scheduler, name, Background));
    expectSuccess(scheduler.setBackgroundConcurrencyWhileInteractive(2));
    expect(jobs.map((job) => job.started)).toEqual([true, true, false]);
    expect(expectFailureCode(scheduler.setBackgroundConcurrencyWhileInteractive(0))).toBe(
      'priority-scheduler.background-limit-invalid',
    );
  });
});

describe('the throughput policy', () => {
  it('lets background take every slot while interactive', () => {
    const scheduler = schedulerWith({ concurrency: 3, policy: SchedulingPolicy.Throughput });
    scheduler.setInteractive(true);
    const jobs = ['a', 'b', 'c'].map((name) => submit(scheduler, name, Background));
    expect(jobs.every((job) => job.started)).toBe(true);
  });

  it('starts jobs in submission order across both priorities', async () => {
    const order: string[] = [];
    const scheduler = schedulerWith({ concurrency: 1, policy: SchedulingPolicy.Throughput });
    const jobs = [
      submit(scheduler, 'batch-1', Background, order),
      submit(scheduler, 'batch-2', Background, order),
      submit(scheduler, 'preview', Foreground, order),
    ];
    for (const job of jobs) {
      job.finish();
      await settle();
    }
    expect(order).toEqual(['batch-1', 'batch-2', 'preview']);
  });

  it('releases held background jobs when the policy changes to it', () => {
    const scheduler = schedulerWith({ concurrency: 3, backgroundConcurrencyWhileInteractive: 1 });
    scheduler.setInteractive(true);
    const jobs = ['a', 'b', 'c'].map((name) => submit(scheduler, name, Background));
    scheduler.setPolicy(SchedulingPolicy.Throughput);
    expect(jobs.every((job) => job.started)).toBe(true);
  });
});

describe('cancellation', () => {
  it('refuses a job whose signal was already cancelled, without running it', async () => {
    const scheduler = schedulerWith();
    const source = createCancellationSource();
    const reason = new Error('closed');
    source.cancel(reason);
    const job = submit(scheduler, 'late', Foreground, [], source.signal);
    await expect(job.outcome).rejects.toBe(reason);
    expect(job.started).toBe(false);
    expect(scheduler.counts.queued.foreground).toBe(0);
  });

  it('removes a queued job when cancelled and rejects with the reason', async () => {
    const scheduler = schedulerWith({ concurrency: 1 });
    const blocker = submit(scheduler, 'blocker', Background);
    const source = createCancellationSource();
    const reason = new Error('the person closed the file');
    const queued = submit(scheduler, 'queued', Background, [], source.signal);
    const after = submit(scheduler, 'after', Background);
    source.cancel(reason);
    await expect(queued.outcome).rejects.toBe(reason);
    expect(scheduler.counts.queued.background).toBe(1);
    blocker.finish();
    await settle();
    expect(queued.started).toBe(false);
    expect(after.started).toBe(true);
  });

  it('rejects with a Cancelled error when the signal gives no error of its own', async () => {
    const scheduler = schedulerWith({ concurrency: 1 });
    submit(scheduler, 'blocker', Background);
    const source = createCancellationSource();
    const queued = submit(scheduler, 'queued', Background, [], source.signal);
    source.cancel('not an error');
    await expect(queued.outcome).rejects.toBeInstanceOf(Cancelled);
  });

  it('passes a running job the caller signal, so cancelling reaches its work', async () => {
    const scheduler = schedulerWith();
    const source = createCancellationSource();
    const job = submit(scheduler, 'render', Foreground, [], source.signal);
    expect(job.signal).toBe(source.signal);
    source.cancel();
    expect(job.signal?.aborted).toBe(true);
    // The job decides how to stop; the scheduler waits for it.
    expect(scheduler.counts.running.foreground).toBe(1);
    job.failWith(new Cancelled());
    await expect(job.outcome).rejects.toBeInstanceOf(Cancelled);
  });

  it('gives a job with no caller signal one that is never cancelled', () => {
    const job = submit(schedulerWith(), 'peaks', Background);
    expect(job.signal?.aborted).toBe(false);
  });
});
