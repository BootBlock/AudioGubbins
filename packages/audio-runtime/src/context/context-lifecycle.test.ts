import { describe, expect, it, vi } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  createDiagnosticCentre,
  createLogStore,
  LogSeverity,
  type LogStore,
} from '@audiogubbins/diagnostics';

import { AudioContextState, type AudioContextOptions } from './audio-context-port.js';
import {
  ContextLifecycle,
  LifecycleEventKind,
  LifecycleState,
  type LifecycleEvent,
} from './context-lifecycle.js';
import { GESTURE_WAIT_MILLISECONDS } from './context-resume.js';
import { FakeAudioContext } from '../testing/fake-audio-context.js';
import { FakeSchedule } from '../testing/playback-rig.js';

/** Audio devices that change on the test's word. */
class FakeDevices {
  readonly #watchers = new Set<() => void>();

  readonly watch = (changed: () => void): (() => void) => {
    this.#watchers.add(changed);
    return () => {
      this.#watchers.delete(changed);
    };
  };

  get watcherCount(): number {
    return this.#watchers.size;
  }

  change(): void {
    for (const watcher of [...this.#watchers]) watcher();
  }
}

interface Harness {
  readonly lifecycle: ContextLifecycle;
  readonly devices: FakeDevices;
  readonly timers: FakeSchedule;
  readonly events: LifecycleEvent[];
  readonly store: LogStore;
  /** Every context made, in order, with what it was made with. */
  readonly made: { readonly context: FakeAudioContext; readonly options: AudioContextOptions }[];
}

function harness(start: () => FakeAudioContext = () => new FakeAudioContext()): Harness {
  const devices = new FakeDevices();
  const events: LifecycleEvent[] = [];
  const store = createLogStore();
  const made: Harness['made'] = [];
  const timers = new FakeSchedule();
  const lifecycle = new ContextLifecycle({
    createContext: (options) => {
      const context = start();
      made.push({ context, options });
      return context;
    },
    watchDevices: devices.watch,
    latencyHint: 'balanced',
    schedule: timers.schedule,
    logger: createDiagnosticCentre(
      store,
      { now: () => 0 },
      { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
    ).loggerFor('audio-runtime'),
  });
  lifecycle.subscribe((event) => {
    events.push(event);
  });
  return { lifecycle, devices, timers, events, store, made };
}

/** The one context a harness has made. */
function onlyContext({ made }: Harness): FakeAudioContext {
  expect(made).toHaveLength(1);
  const [first] = made;
  if (first === undefined) throw new Error('No context was made.');
  return first.context;
}

/** Whether `promise` has settled once every pending callback has run. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return settled;
}

function messages({ store }: Harness): string[] {
  return store.snapshot().map((record) => record.message);
}

/** A harness whose context has been started from a gesture, with no events yet. */
async function running(): Promise<Harness> {
  const started = harness();
  expectSuccess(await started.lifecycle.ensureRunning());
  started.events.length = 0;
  return started;
}

describe('ContextLifecycle', () => {
  describe('under the autoplay rule', () => {
    it('makes no context until one is needed', () => {
      const { lifecycle, made } = harness();

      expect(made).toEqual([]);
      expect(lifecycle.state).toBe(LifecycleState.Idle);
      expect(lifecycle.report).toBeUndefined();
    });

    it('makes the context with the profile’s latency hint, suspended until a gesture', () => {
      const started = harness();

      const context = started.lifecycle.context();

      expect(started.made.map(({ options }) => options)).toEqual([{ latencyHint: 'balanced' }]);
      expect(context.state).toBe(AudioContextState.Suspended);
      expect(started.lifecycle.state).toBe(LifecycleState.Suspended);
      expect(started.lifecycle.context()).toBe(context);
    });

    it('resumes the suspended context from the person’s Play', async () => {
      const started = harness();

      const context = expectSuccess(await started.lifecycle.ensureRunning());

      expect(context).toBe(onlyContext(started));
      expect(context.state).toBe(AudioContextState.Running);
      expect(started.lifecycle.state).toBe(LifecycleState.Running);
      // Starting is the person's doing, so the transport is told nothing.
      expect(started.events).toEqual([]);
    });

    it('does not resume a context that is already running', async () => {
      const started = await running();
      const context = onlyContext(started);

      expectSuccess(await started.lifecycle.ensureRunning());

      expect(context.resumeCalls).toBe(1);
    });

    it('waits a bounded time on a resume the browser holds for a gesture, then says it waits for one', async () => {
      const started = harness(() => new FakeAudioContext({ allowedToStart: false }));

      const result = started.lifecycle.ensureRunning();
      started.timers.advance(GESTURE_WAIT_MILLISECONDS - 1);
      expect(await hasSettled(result)).toBe(false);
      started.timers.advance(1);

      const settled = await result;
      expect(settled.ok ? undefined : settled.failures[0].code).toBe(
        'audio.context-awaiting-gesture',
      );
      expect(settled.ok ? '' : settled.failures[0].summary).toMatch(/click or a key press/);
      expect(started.lifecycle.state).toBe(LifecycleState.AwaitingGesture);
    });

    it('lets the resume it stopped waiting on start the context at the next gesture', async () => {
      const started = harness(() => new FakeAudioContext({ allowedToStart: false }));
      const result = started.lifecycle.ensureRunning();
      started.timers.advance(GESTURE_WAIT_MILLISECONDS);
      await result;
      const context = onlyContext(started);
      expect(context.pendingResumeCount).toBe(1);

      context.gesture();

      expect(context.state).toBe(AudioContextState.Running);
      expect(started.lifecycle.state).toBe(LifecycleState.Running);
      expect(context.resumeCalls).toBe(1);
    });

    it('succeeds once the context runs, though the browser has not yet settled the resume', async () => {
      const started = harness(() => new FakeAudioContext({ allowedToStart: false }));
      const context = started.lifecycle.context();
      // A resume whose promise never settles, so only the state change can end the wait.
      vi.spyOn(context, 'resume').mockReturnValueOnce(new Promise(() => undefined));
      const result = started.lifecycle.ensureRunning();

      onlyContext(started).becomes(AudioContextState.Running);

      expectSuccess(await result);
      expect(started.timers.pending).toBe(0);
    });

    it('says the system holds a context whose resume it keeps waiting', async () => {
      const started = await running();
      const context = onlyContext(started);
      context.becomes(AudioContextState.Interrupted);

      const result = started.lifecycle.ensureRunning();
      started.timers.advance(GESTURE_WAIT_MILLISECONDS);

      const settled = await result;
      expect(settled.ok ? undefined : settled.failures[0].code).toBe('audio.context-not-running');
      expect(started.lifecycle.state).toBe(LifecycleState.Interrupted);
    });

    it('answers a resume the closing of the context cancels with a refusal', async () => {
      const started = harness(() => new FakeAudioContext({ allowedToStart: false }));
      const result = started.lifecycle.ensureRunning();

      onlyContext(started).becomes(AudioContextState.Closed);

      const settled = await result;
      expect(settled.ok ? undefined : settled.failures[0].code).toBe(
        'audio.context-resume-refused',
      );
      expect(started.timers.pending).toBe(0);
    });

    it('lets a fault in a resume surface as itself', async () => {
      const started = harness();
      const context = started.lifecycle.context();
      const fault = new TypeError('Illegal invocation.');
      vi.spyOn(context, 'resume').mockRejectedValueOnce(fault);

      await expect(started.lifecycle.ensureRunning()).rejects.toBe(fault);
      expect(started.timers.pending).toBe(0);
    });

    it('reports the output latency the device gives once audio flows', async () => {
      // Browsers give no output latency while a context is suspended.
      const started = harness(() => new FakeAudioContext({ outputLatency: 0 }));
      started.lifecycle.context();
      expect(started.lifecycle.report?.outputLatencySeconds).toBe(0);

      onlyContext(started).outputLatency = 0.012;
      expectSuccess(await started.lifecycle.ensureRunning());

      expect(started.lifecycle.report?.outputLatencySeconds).toBe(0.012);
      expect(started.events).toEqual([
        { kind: LifecycleEventKind.DeviceChanged, report: started.lifecycle.report },
      ]);
    });
  });

  describe('suspension', () => {
    it('reports nothing when the runtime suspends the context itself', async () => {
      const started = await running();

      expectSuccess(await started.lifecycle.suspend());

      expect(started.lifecycle.state).toBe(LifecycleState.Suspended);
      expect(started.events).toEqual([]);
    });

    it('reports a system suspension and the return from it at the frames they happened', async () => {
      const started = await running();
      const context = onlyContext(started);

      context.currentTime = 2.5;
      context.becomes(AudioContextState.Suspended);
      context.becomes(AudioContextState.Running);

      expect(started.events).toEqual([
        { kind: LifecycleEventKind.SuspendedBySystem, contextFrame: 120_000 },
        { kind: LifecycleEventKind.Resumed, contextFrame: 120_000 },
      ]);
    });

    it('rounds the context frame to the nearest whole frame', async () => {
      const started = await running();
      const context = onlyContext(started);

      // 100004 frames at 48 kHz come back from seconds as 100003.99999999999.
      context.currentTime = 100_004 / 48_000;
      expect(context.currentTime * context.sampleRate).toBeLessThan(100_004);
      context.becomes(AudioContextState.Suspended);

      expect(started.events).toEqual([
        { kind: LifecycleEventKind.SuspendedBySystem, contextFrame: 100_004 },
      ]);
    });

    it('treats Safari’s interruption as a system suspension', async () => {
      const started = await running();
      const context = onlyContext(started);

      context.currentTime = 1;
      context.becomes(AudioContextState.Interrupted);
      expect(started.lifecycle.state).toBe(LifecycleState.Interrupted);
      context.currentTime = 1;
      context.becomes(AudioContextState.Running);

      expect(started.events).toEqual([
        { kind: LifecycleEventKind.SuspendedBySystem, contextFrame: 48_000 },
        { kind: LifecycleEventKind.Resumed, contextFrame: 48_000 },
      ]);
    });

    it('answers a suspension a closed context refuses with a failure, and lets a fault surface', async () => {
      const started = await running();
      const context = onlyContext(started);
      vi.spyOn(context, 'suspend').mockRejectedValueOnce(
        new DOMException('Cannot suspend a closed AudioContext.', 'InvalidStateError'),
      );

      const refused = await started.lifecycle.suspend();
      expect(refused.ok ? undefined : refused.failures[0].code).toBe(
        'audio.context-suspend-failed',
      );

      const fault = new TypeError('Illegal invocation.');
      vi.spyOn(context, 'suspend').mockRejectedValueOnce(fault);
      await expect(started.lifecycle.suspend()).rejects.toBe(fault);
    });

    it('reports no system suspension of a context the runtime had already suspended', async () => {
      const started = await running();
      expectSuccess(await started.lifecycle.suspend());

      onlyContext(started).becomes(AudioContextState.Interrupted);

      expect(started.events).toEqual([]);
    });

    it('reports the return when Play resumes a context the system suspended', async () => {
      const started = await running();
      const context = onlyContext(started);
      context.currentTime = 0.5;
      context.becomes(AudioContextState.Suspended);

      expectSuccess(await started.lifecycle.ensureRunning());

      expect(started.events).toEqual([
        { kind: LifecycleEventKind.SuspendedBySystem, contextFrame: 24_000 },
        { kind: LifecycleEventKind.Resumed, contextFrame: 24_000 },
      ]);
    });
  });

  describe('when the devices change', () => {
    it('reports the device again, and only where the report differs', async () => {
      const started = await running();
      const context = onlyContext(started);

      started.devices.change();
      expect(started.events).toEqual([]);

      context.destination.maxChannelCount = 6;
      context.outputLatency = 0.04;
      started.devices.change();

      const report = {
        sampleRate: 48_000,
        baseLatencySeconds: 128 / 48_000,
        outputLatencySeconds: 0.04,
        maxChannelCount: 6,
        channelCount: 2,
      };
      expect(started.events).toEqual([{ kind: LifecycleEventKind.DeviceChanged, report }]);
      expect(started.lifecycle.report).toEqual(report);
    });

    it('resumes a context the system suspended, once, and logs that it did', async () => {
      const started = await running();
      const context = onlyContext(started);
      context.currentTime = 3;
      context.becomes(AudioContextState.Suspended);

      started.devices.change();

      await vi.waitFor(() => {
        expect(started.store.snapshot().map((record) => record.message)).toContain(
          'The audio context resumed after the audio devices changed.',
        );
      });
      expect(context.state).toBe(AudioContextState.Running);
      expect(context.resumeCalls).toBe(2);
      expect(started.events).toEqual([
        { kind: LifecycleEventKind.SuspendedBySystem, contextFrame: 144_000 },
        { kind: LifecycleEventKind.Resumed, contextFrame: 144_000 },
      ]);
    });

    it('logs a recovery that waits for a gesture, and completes it at the gesture', async () => {
      const started = await running();
      const context = onlyContext(started);
      context.currentTime = 1;
      context.becomes(AudioContextState.Suspended);
      context.allowedToStart = false;

      started.devices.change();
      started.timers.advance(GESTURE_WAIT_MILLISECONDS);

      await vi.waitFor(() => {
        expect(messages(started)).toContain(
          'The audio context could not resume after the audio devices changed.',
        );
      });
      expect(context.resumeCalls).toBe(2);
      expect(started.lifecycle.state).toBe(LifecycleState.AwaitingGesture);

      context.gesture();

      expect(started.lifecycle.state).toBe(LifecycleState.Running);
      expect(started.events).toEqual([
        { kind: LifecycleEventKind.SuspendedBySystem, contextFrame: 48_000 },
        { kind: LifecycleEventKind.Resumed, contextFrame: 48_000 },
      ]);
    });

    it('logs a recovery the system still holds, and tries no more until the next change', async () => {
      const started = await running();
      const context = onlyContext(started);
      context.becomes(AudioContextState.Interrupted);

      started.devices.change();
      started.timers.advance(GESTURE_WAIT_MILLISECONDS);

      await vi.waitFor(() => {
        expect(messages(started)).toContain(
          'The audio context could not resume after the audio devices changed.',
        );
      });
      expect(context.resumeCalls).toBe(2);
      expect(started.lifecycle.state).toBe(LifecycleState.Interrupted);
    });

    it('leaves a context the runtime suspended itself suspended', async () => {
      const started = await running();
      const context = onlyContext(started);
      expectSuccess(await started.lifecycle.suspend());

      started.devices.change();
      await Promise.resolve();

      expect(context.resumeCalls).toBe(1);
      expect(context.state).toBe(AudioContextState.Suspended);
    });
  });

  describe('when the context closes unasked', () => {
    it('reports it lost, stops watching its devices and makes a new one when next needed', async () => {
      const started = await running();
      const lost = onlyContext(started);

      lost.becomes(AudioContextState.Closed);

      expect(started.events).toEqual([{ kind: LifecycleEventKind.Lost }]);
      expect(started.lifecycle.state).toBe(LifecycleState.Closed);
      expect(started.devices.watcherCount).toBe(0);
      expect(lost.stateListenerCount).toBe(0);

      const next = started.lifecycle.context();
      expect(next).not.toBe(lost);
      expect(started.made).toHaveLength(2);
      expect(started.devices.watcherCount).toBe(1);
    });
  });

  describe('close', () => {
    it('stops watching, detaches from the context, closes it and tells no one', async () => {
      const started = await running();
      const context = onlyContext(started);

      await started.lifecycle.close();

      expect(context.closeCalls).toBe(1);
      expect(context.state).toBe(AudioContextState.Closed);
      expect(context.stateListenerCount).toBe(0);
      expect(started.devices.watcherCount).toBe(0);
      expect(started.events).toEqual([]);
      expect(started.lifecycle.state).toBe(LifecycleState.Closed);
      // Detached before closing, so the close it asked for is not taken for a loss.
      expect(started.store.snapshot().map((record) => record.message)).not.toContain(
        'The audio context closed without being asked to.',
      );
    });

    it('takes a close a context already closed refuses as done, and lets a fault surface', async () => {
      const refusing = await running();
      vi.spyOn(onlyContext(refusing), 'close').mockRejectedValueOnce(
        new DOMException('Cannot close a closed AudioContext.', 'InvalidStateError'),
      );
      await refusing.lifecycle.close();
      expect(messages(refusing)).toContain('The audio context had already closed.');

      const faulting = await running();
      const fault = new TypeError('Illegal invocation.');
      vi.spyOn(onlyContext(faulting), 'close').mockRejectedValueOnce(fault);
      await expect(faulting.lifecycle.close()).rejects.toBe(fault);
    });

    it('hands out no context afterwards', async () => {
      const started = harness();

      await started.lifecycle.close();

      expect(() => started.lifecycle.context()).toThrow(/closed/);
      expect(started.made).toEqual([]);
    });
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const started = await running();
    const heard: LifecycleEvent[] = [];
    const unsubscribe = started.lifecycle.subscribe((event) => {
      heard.push(event);
    });

    unsubscribe();
    onlyContext(started).becomes(AudioContextState.Suspended);

    expect(heard).toEqual([]);
    expect(started.events).toHaveLength(1);
  });
});
