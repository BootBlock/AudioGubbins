/**
 * A playback session wired end to end without a browser, for the session's
 * tests: a fake context whose worklet nodes run the real processor, fake
 * feeder workers that run the real feeder, joined by fake channels, a
 * lifecycle over the context, a timer that runs on the test's clock, and a
 * log store to read what was logged.
 *
 * Time moves only when the test renders. Each render quantum advances the
 * context's clock by 128 frames while it runs, and the timer's clock by the
 * same time whether it runs or not, as timers go on while a context is
 * suspended. Between quanta every pending read and message settles, which is
 * the most generous a browser could be to the feeder; a test that starves a
 * feed does so with a source that does not answer.
 */

import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  createDiagnosticCentre,
  createLogStore,
  LogSeverity,
  type LogStore,
} from '@audiogubbins/diagnostics';
import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  PRESET_SETTINGS,
  PerformanceProfile,
  type PcmSource,
  type PresetProfile,
} from '@audiogubbins/audio-engine';

import { AudioContextState, type WorkletNodeShape } from '../context/audio-context-port.js';
import { ContextLifecycle } from '../context/context-lifecycle.js';
import type { Schedule } from '../schedule.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import { PlaybackDspKind, type PlaybackDsp } from '../playback/playback-dsp.js';
import { PlaybackSession } from '../playback/playback-session.js';
import { FakeAudioContext, type FakeAudioContextSettings } from './fake-audio-context.js';
import { FakeFeederWorker } from './fake-feeder-worker.js';
import { fakeChannel } from './fake-message-channel.js';
import { FakeWorkletNode } from './fake-worklet-node.js';

/** The URL the rig says the processor's module is at. */
export const WORKLET_MODULE_URL = 'engine-processor.js';

/** A timer on a clock the test moves. */
export class FakeSchedule {
  #now = 0;
  #nextId = 0;
  readonly #pending = new Map<number, { readonly due: number; readonly callback: () => void }>();

  /** The clock's time now, in milliseconds since the rig was made. */
  get now(): number {
    return this.#now;
  }

  readonly schedule: Schedule = (callback, delayMs) => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#pending.set(id, { due: this.#now + delayMs, callback });
    return () => {
      this.#pending.delete(id);
    };
  };

  /** How many callbacks wait to run. */
  get pending(): number {
    return this.#pending.size;
  }

  /** Moves the clock on by `milliseconds`, running each callback that falls due, in order. */
  advance(milliseconds: number): void {
    const until = this.#now + milliseconds;
    for (;;) {
      const next = [...this.#pending].sort(([, one], [, other]) => one.due - other.due)[0];
      if (next === undefined || next[1].due > until) break;
      const [id, { due, callback }] = next;
      this.#pending.delete(id);
      this.#now = due;
      callback();
    }
    this.#now = until;
  }
}

/** A fake context whose worklet nodes run the engine's processor, and every node it made. */
export interface PlaybackContext {
  readonly context: FakeAudioContext;
  readonly nodes: FakeWorkletNode[];
  /** Every module URL added to it. */
  readonly modules: string[];
}

/**
 * A fake context given worklet nodes and a worklet, which the plain fake
 * refuses so that a test not about playback cannot make one by mistake.
 */
function playbackContext(
  settings: FakeAudioContextSettings,
  lost: ((message: unknown) => boolean) | undefined,
): PlaybackContext {
  const context = new FakeAudioContext(settings);
  const nodes: FakeWorkletNode[] = [];
  const modules: string[] = [];
  Object.assign(context.audioWorklet, {
    addModule: (url: string): Promise<void> => {
      modules.push(url);
      return Promise.resolve();
    },
  });
  Object.assign(context, {
    createWorkletNode: (processorName: string, shape: WorkletNodeShape): FakeWorkletNode => {
      const node = new FakeWorkletNode(processorName, shape, context.sampleRate, lost);
      nodes.push(node);
      return node;
    },
  });
  return { context, nodes, modules };
}

/**
 * Node's `setImmediate`, which the page's definitions this package compiles
 * against do not declare, or `setTimeout` where there is none.
 */
const nextTurn: (callback: () => void) => void = ((): ((callback: () => void) => void) => {
  const immediate: unknown = Reflect.get(globalThis, 'setImmediate');
  if (typeof immediate === 'function') {
    return (callback) => {
      Reflect.apply(immediate, globalThis, [callback]);
    };
  }
  return (callback) => {
    setTimeout(callback, 0);
  };
})();

/**
 * Lets every pending read, message and reply settle. The fakes deliver on
 * microtasks alone, which one turn of the event loop drains however deep they
 * go, and an immediate is that turn without the millisecond a timer waits.
 */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    nextTurn(resolve);
  });
}

/** Audio devices that change on the test's word. */
export class FakeDevices {
  readonly #watchers = new Set<() => void>();

  readonly watch = (changed: () => void): (() => void) => {
    this.#watchers.add(changed);
    return () => {
      this.#watchers.delete(changed);
    };
  };

  change(): void {
    for (const watcher of [...this.#watchers]) watcher();
  }
}

/** What a rig is made with. */
export interface PlaybackRigOptions {
  readonly sharedMemory?: boolean;
  /** Whether the page can compile WebAssembly; it can, by default. */
  readonly webAssembly?: boolean;
  readonly profile?: PresetProfile;
  readonly context?: FakeAudioContextSettings;
  /** The DSP module for the worklet and the feeder; none, by default. */
  readonly dsp?: PlaybackDsp;
  /** Which of the main thread's messages to the processor never arrive. */
  readonly lost?: (message: unknown) => boolean;
  /** Puts a test's reads in front of each source the feeder makes, a read that stalls or fails. */
  readonly readThrough?: (node: NodeId, source: PcmSource) => PcmSource;
}

/** A session and everything it runs on. */
export class PlaybackRig {
  readonly session: PlaybackSession;
  readonly lifecycle: ContextLifecycle;
  readonly schedule = new FakeSchedule();
  readonly devices = new FakeDevices();
  readonly store: LogStore = createLogStore();
  /** Every context the lifecycle made, in order. */
  readonly contexts: PlaybackContext[] = [];
  /** Every feeder worker the session started, in order. */
  readonly feeders: FakeFeederWorker[] = [];

  constructor(options: PlaybackRigOptions = {}) {
    const profile = options.profile ?? PerformanceProfile.Balanced;
    const logger = createDiagnosticCentre(
      this.store,
      { now: () => 0 },
      { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
    ).loggerFor('audio-runtime');
    this.lifecycle = new ContextLifecycle({
      createContext: () => {
        const made = playbackContext(options.context ?? {}, options.lost);
        this.contexts.push(made);
        return made.context;
      },
      watchDevices: this.devices.watch,
      latencyHint: PRESET_SETTINGS[profile].latencyHint,
      schedule: this.schedule.schedule,
      logger,
    });
    const capabilities: AudioRuntimeCapabilities = {
      playback: true,
      offlineRendering: true,
      webAssembly: options.webAssembly ?? true,
      sharedMemory: options.sharedMemory ?? false,
      outputSelection: false,
      gpu: false,
    };
    this.session = new PlaybackSession({
      lifecycle: this.lifecycle,
      capabilities,
      dsp: options.dsp ?? {
        kind: PlaybackDspKind.Unavailable,
        reason: 'This test compiles no DSP module.',
      },
      profile,
      settings: PRESET_SETTINGS[profile],
      workletModuleUrl: WORKLET_MODULE_URL,
      threads: {
        createFeeder: () => {
          const feeder = new FakeFeederWorker({
            schedule: this.schedule.schedule,
            ...(options.readThrough === undefined ? {} : { readThrough: options.readThrough }),
          });
          this.feeders.push(feeder);
          return feeder;
        },
        createChannel: fakeChannel,
      },
      schedule: this.schedule.schedule,
      logger,
    });
  }

  /** The context the lifecycle made last. */
  get current(): PlaybackContext {
    const made = this.contexts.at(-1);
    if (made === undefined) throw new Error('No context has been made yet.');
    return made;
  }

  /** The feeder worker the session started last. */
  get feeder(): FakeFeederWorker {
    const feeder = this.feeders.at(-1);
    if (feeder === undefined) throw new Error('No feeder worker has been started yet.');
    return feeder;
  }

  /** The node the current context made last. */
  get node(): FakeWorkletNode {
    const node = this.current.nodes.at(-1);
    if (node === undefined) throw new Error('No worklet node has been made yet.');
    return node;
  }

  /** The context frame the current context has reached. */
  get frame(): number {
    const { context } = this.current;
    return Math.round(context.currentTime * context.sampleRate);
  }

  /**
   * Renders `quanta` render quanta: each connected node renders while the
   * context runs, the clocks move on, and everything pending settles.
   */
  async render(quanta: number): Promise<void> {
    const { context, nodes } = this.current;
    const quantumMilliseconds = (RENDER_QUANTUM_FRAMES * 1000) / context.sampleRate;
    for (let quantum = 0; quantum < quanta; quantum += 1) {
      if (context.state === AudioContextState.Running) {
        const frame = this.frame;
        for (const node of nodes) if (node.connectedTo !== undefined) node.render(frame);
        context.currentTime = (frame + RENDER_QUANTUM_FRAMES) / context.sampleRate;
      }
      this.schedule.advance(quantumMilliseconds);
      await settle();
    }
  }

  /** The position, which a test expects to read. */
  position(): number {
    return expectSuccess(this.session.position());
  }
}
