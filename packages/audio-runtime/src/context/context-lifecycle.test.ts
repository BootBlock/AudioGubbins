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
import { FakeAudioContext } from '../testing/fake-audio-context.js';

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
  const lifecycle = new ContextLifecycle({
    createContext: (options) => {
      const context = start();
      made.push({ context, options });
      return context;
    },
    watchDevices: devices.watch,
    latencyHint: 'balanced',
    logger: createDiagnosticCentre(
      store,
      { now: () => 0 },
      { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
    ).loggerFor('audio-runtime'),
  });
  lifecycle.subscribe((event) => {
    events.push(event);
  });
  return { lifecycle, devices, events, store, made };
}

/** The one context a harness has made. */
function onlyContext({ made }: Harness): FakeAudioContext {
  expect(made).toHaveLength(1);
  const [first] = made;
  if (first === undefined) throw new Error('No context was made.');
  return first.context;
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

    it('answers a refused resume with a failure that asks for a click or a key press', async () => {
      const started = harness();
      started.lifecycle.context();
      onlyContext(started).refuseResume = new DOMException(
        'Not allowed to start.',
        'NotAllowedError',
      );

      const result = await started.lifecycle.ensureRunning();

      expect(result.ok).toBe(false);
      const failure = result.ok ? undefined : result.failures[0];
      expect(failure?.code).toBe('audio.context-resume-refused');
      expect(failure?.summary).toMatch(/click or a key press/);
      expect(started.lifecycle.state).toBe(LifecycleState.Suspended);
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

    it('logs a recovery the browser refuses, and tries no more until the next change', async () => {
      const started = await running();
      const context = onlyContext(started);
      context.becomes(AudioContextState.Interrupted);
      context.refuseResume = new DOMException('The device is in use.', 'InvalidStateError');

      started.devices.change();

      await vi.waitFor(() => {
        expect(started.store.snapshot().map((record) => record.message)).toContain(
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
