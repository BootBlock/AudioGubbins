import { describe, expect, it } from 'vitest';

import { derivedSampleCount, sampleRate, type SampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { PageVisibility } from '@audiogubbins/capabilities';
import type { RecordingSchedule } from '@audiogubbins/recording';

import { ControlledRun } from './controlled-run.js';

const RATE = expectSuccess(sampleRate(48_000));
/** How early a step is acted on: a fifth of a second, longer than a timer is late. */
const LEAD = 0.2 * 48_000;

/** A clock and a timer a test steps, and a page it hides. */
function stepped() {
  let frame = 0;
  let visible: PageVisibility = 'visible';
  const timers: { readonly due: number; readonly callback: () => void }[] = [];
  const watchers = new Set<(visibility: PageVisibility) => void>();
  const done: string[] = [];
  const clock = {
    frame: (): SampleCount | undefined => derivedSampleCount(frame),
    rate: RATE,
    schedule: (callback: () => void, milliseconds: number) => {
      const timer = { due: frame + Math.round((milliseconds / 1_000) * 48_000), callback };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    visible: () => visible === 'visible',
    watch: (changed: (visibility: PageVisibility) => void) => {
      watchers.add(changed);
      return () => watchers.delete(changed);
    },
  };
  const actions = {
    countIn: (at: SampleCount) => done.push(`count-in to ${String(at)}`),
    record: (at: SampleCount) => done.push(`record at ${String(at)}`),
    suspended: () => done.push('suspended'),
    cancelled: (reason: string) => done.push(`cancelled: ${reason}`),
  };
  return {
    clock,
    actions,
    done,
    timers,
    /** Moves the clock to `to`, firing every timer due by then. */
    advance(to: number): void {
      frame = to;
      for (const timer of timers.filter((one) => one.due <= to)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
    },
    hide(): void {
      visible = 'hidden';
      for (const watcher of [...watchers]) watcher('hidden');
    },
    /** The page says it is in view, as a browser does again on coming back to a tab. */
    shown(): void {
      for (const watcher of [...watchers]) watcher('visible');
    },
  };
}

function schedule(countInFrom: number, recordAt: number): RecordingSchedule {
  return { countInFrom: derivedSampleCount(countInFrom), recordAt: derivedSampleCount(recordAt) };
}

describe('a controlled recording kept to its schedule', () => {
  it('waits for a set start, then counts in, a lead early, giving the frame it records on', () => {
    const test = stepped();
    const run = new ControlledRun(schedule(480_000, 576_000), test.clock, test.actions);
    expect(test.done).toEqual([]);
    test.advance(480_000 - LEAD);
    expect(test.done).toEqual(['count-in to 576000']);
    // The take begins on its frame by itself, and nothing more is done for
    // it, whatever the page says of itself meanwhile.
    test.advance(576_000);
    test.shown();
    expect(test.done).toEqual(['count-in to 576000']);
    run.end();
  });

  it('records at once on the frame given where there is no count-in', () => {
    const test = stepped();
    const run = new ControlledRun(schedule(0, 0), test.clock, test.actions);
    expect(test.done).toEqual(['record at 0']);
    run.end();
  });

  it('cancels a schedule the page is hidden before, and stops a recording it is hidden during', () => {
    const waiting = stepped();
    new ControlledRun(schedule(480_000, 480_000), waiting.clock, waiting.actions);
    waiting.hide();
    expect(waiting.done).toEqual([
      'cancelled: The scheduled recording was cancelled because the page was hidden before it began.',
    ]);
    expect(waiting.timers).toEqual([]);

    const recording = stepped();
    const run = new ControlledRun(schedule(0, 0), recording.clock, recording.actions);
    run.recording();
    recording.hide();
    expect(recording.done).toEqual(['record at 0', 'suspended']);
  });

  it('does nothing more once ended', () => {
    const test = stepped();
    const run = new ControlledRun(schedule(480_000, 576_000), test.clock, test.actions);
    run.end();
    test.advance(1_000_000);
    test.hide();
    expect(test.done).toEqual([]);
  });
});
