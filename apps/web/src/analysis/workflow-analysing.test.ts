import { describe, expect, it } from 'vitest';

import { observable } from '../state/observable.js';
import { WorkflowAnalysing, type WorkflowAnalysisJob } from './workflow-analysing.js';

/** Jobs over one store of what is running, each ended by the test. */
function jobsOver(names: readonly string[]) {
  const running = observable<ReadonlySet<string>>(new Set());
  const started: string[] = [];
  const cancelled: string[] = [];
  const jobs: WorkflowAnalysisJob[] = names.map((name) => ({
    name,
    start: () => {
      started.push(name);
      running.update((now) => new Set([...now, name]));
    },
    running: () => running.get().has(name),
    cancel: () => {
      cancelled.push(name);
      running.update((now) => new Set([...now].filter((one) => one !== name)));
    },
  }));
  const end = (name: string): void => {
    running.update((now) => new Set([...now].filter((one) => one !== name)));
  };
  return { running, jobs, started, cancelled, end };
}

describe('a workflow’s analyses', () => {
  it('run one at a time, each once the one before has ended', () => {
    // All at once, a group of forty sounds would describe forty sounds to the
    // worker in one go.
    const { running, jobs, started, end } = jobsOver(['Door', 'Step', 'Bell']);
    const analysing = new WorkflowAnalysing([running]);

    analysing.run(jobs);
    expect(started).toEqual(['Door']);
    expect(analysing.get()).toEqual({ kind: 'running', done: 0, total: 3, current: 'Door' });

    end('Door');
    expect(started).toEqual(['Door', 'Step']);
    end('Step');
    end('Bell');
    expect(started).toEqual(['Door', 'Step', 'Bell']);
    expect(analysing.get()).toEqual({ kind: 'idle' });
  });

  it('stop at the one running, and start none after it, when cancelled', () => {
    const { running, jobs, started, cancelled, end } = jobsOver(['Door', 'Step']);
    const analysing = new WorkflowAnalysing([running]);
    analysing.run(jobs);

    expect(analysing.cancel()).toBe(true);
    end('Door');

    expect(cancelled).toEqual(['Door']);
    expect(started).toEqual(['Door']);
    expect(analysing.get()).toEqual({ kind: 'idle' });
    expect(analysing.cancel()).toBe(false);
  });

  it('go on past a job that does not start, as one that ended at once', () => {
    const { running, jobs, started } = jobsOver(['Door', 'Step']);
    const [door, step] = jobs;
    if (door === undefined || step === undefined) throw new Error('Two jobs were made.');
    const never: WorkflowAnalysisJob = { ...door, start: () => undefined, running: () => false };
    const analysing = new WorkflowAnalysing([running]);

    analysing.run([never, step]);

    expect(started).toEqual(['Step']);
  });
});
