/**
 * The audio part's collaborators as fakes, for the tests of the commands, the
 * controls and the panel.
 *
 * jsdom has no audio context, worklet or worker, and a real one would answer
 * to the machine's devices rather than to the test, so the controls are handed
 * these at the seams they take: a session that moves its transport by the
 * engine's own rules on the test's word, and a render host that writes the
 * chunks a test gives it.
 */

import {
  StandardLayouts,
  fail,
  flatMapResult,
  failure,
  FailureKind,
  sampleRate,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  DspImplementation,
  TRANSPORT_AT_START,
  frameBlock,
  nextTransportState,
  transportPosition,
  type PerformanceSettings,
  type RenderProgress,
  type SchedulingPolicy,
  type TransportEvent,
} from '@audiogubbins/audio-engine';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  LifecycleState,
  PlaybackPhase,
  type DeviceReport,
  type DspStatus,
  type MeterLevels,
  type PlaybackListener,
  type PlaybackRequest,
  type PlaybackStatus,
  type RenderHost,
  type RenderRequest,
  type RenderRunOptions,
  type WorkerRenderSummary,
} from '@audiogubbins/audio-runtime';

import { vi } from 'vitest';

import type { PlaybackParts, PlaybackSessionPort } from '../audio/playback-control.js';
import type { RenderParts } from '../audio/render-control.js';
import type { ChosenProfile } from '../state/audio-settings-store.js';
import type { AudioViewStore } from '../state/audio-view-store.js';
import { PROMPTLY } from './waiting.js';

/** The rate the fake context runs at. */
export const FAKE_CONTEXT_RATE = 48_000;

const CLOCK = {
  timelineRate: expectSuccess(sampleRate(FAKE_CONTEXT_RATE)),
  contextRate: expectSuccess(sampleRate(FAKE_CONTEXT_RATE)),
};

/** A device with 10 ms of its own and 20 ms after it, as a browser reports it once audio flows. */
export const FAKE_DEVICE: DeviceReport = {
  sampleRate: FAKE_CONTEXT_RATE,
  baseLatencySeconds: 0.01,
  outputLatencySeconds: 0.02,
  maxChannelCount: 2,
  channelCount: 2,
};

/** Playback before anything is loaded, as a session begins. */
export const UNLOADED: PlaybackStatus = {
  phase: PlaybackPhase.Unloaded,
  transport: TRANSPORT_AT_START,
  processorDsp: undefined,
  feederDsp: undefined,
  latencyFrames: undefined,
  device: undefined,
  contextState: LifecycleState.Idle,
  stability: undefined,
  problems: [],
};

/** A DSP on the WebAssembly module, used by what runs on it or not. */
function onTheModule(inUse: boolean): DspStatus {
  return { implementation: DspImplementation.WebAssembly, fallbackReason: undefined, inUse };
}

/** A session that loads at once and moves its transport as the engine's rules say. */
export class FakeSession implements PlaybackSessionPort {
  status: PlaybackStatus = UNLOADED;
  readonly loads: PlaybackRequest[] = [];
  readonly seeks: SampleCount[] = [];
  /** The context frame now, which a test moves to move the position. */
  contextFrame = 0;
  /** What the next Play answers, where a test wants it refused. */
  playResult: DomainResult<void> = succeed(undefined);
  /** Each meter's levels, as the processor last reported them. */
  levels: ReadonlyMap<NodeId, MeterLevels> = new Map();
  disposed = false;
  readonly #listeners = new Set<PlaybackListener>();

  subscribe(listener: PlaybackListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  load(request: PlaybackRequest): Promise<DomainResult<void>> {
    this.loads.push(request);
    this.show({
      ...this.status,
      phase: PlaybackPhase.Ready,
      processorDsp: onTheModule(false),
      feederDsp: onTheModule(true),
      latencyFrames: 0,
      device: FAKE_DEVICE,
      contextState: LifecycleState.Suspended,
    });
    return Promise.resolve(succeed(undefined));
  }

  play(): Promise<DomainResult<void>> {
    if (!this.playResult.ok) return Promise.resolve(this.playResult);
    this.show({ ...this.status, contextState: LifecycleState.Running });
    return Promise.resolve(this.startPlaying());
  }

  pause(): DomainResult<void> {
    return this.move({ kind: 'pause', contextFrame: this.contextFrame });
  }

  stop(): DomainResult<void> {
    return this.move({ kind: 'stop' });
  }

  seek(to: SampleCount): Promise<DomainResult<void>> {
    this.seeks.push(to);
    return Promise.resolve(this.move({ kind: 'seek', to, contextFrame: this.contextFrame }));
  }

  position(): DomainResult<SampleCount> {
    return transportPosition(this.status.transport, CLOCK, this.contextFrame);
  }

  audiblePosition(): DomainResult<SampleCount> {
    return this.position();
  }

  meters(): ReadonlyMap<NodeId, MeterLevels> {
    return this.levels;
  }

  /** Plays from where the transport is, as the processor says when it starts. */
  startPlaying(): DomainResult<void> {
    return flatMapResult(this.position(), (position) =>
      this.move({ kind: 'play', contextFrame: this.contextFrame, position }),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.#listeners.clear();
  }

  /** Reports `status` as the session's own, as a reply from the processor would. */
  show(status: PlaybackStatus): void {
    this.status = status;
    for (const listener of [...this.#listeners]) listener(status);
  }

  move(event: TransportEvent): DomainResult<void> {
    const next = nextTransportState(this.status.transport, event, CLOCK);
    if (!next.ok) return next;
    this.show({ ...this.status, transport: next.value });
    return succeed(undefined);
  }
}

/** One profile's fake parts, and what was asked of them. */
export interface FakeOpened {
  readonly profile: ChosenProfile;
  readonly session: FakeSession;
  contextStarts: number;
  closed: boolean;
}

/** Parts that are made at once, each over a new fake session, as the controls ask. */
export class FakePlayback {
  readonly opened: FakeOpened[] = [];
  /** Why the session cannot be made, where a test wants its loading to fail. */
  loadingFails: Error | undefined;
  /** What each new session's Play answers, where a test wants the context refused. */
  playRefusal: DomainResult<void> | undefined;

  readonly open = (profile: ChosenProfile): PlaybackParts => {
    const made: FakeOpened = {
      profile,
      session: new FakeSession(),
      contextStarts: 0,
      closed: false,
    };
    if (this.playRefusal !== undefined) made.session.playResult = this.playRefusal;
    this.opened.push(made);
    const failing = this.loadingFails;
    return {
      startContext: () => {
        made.contextStarts += 1;
      },
      contextRate: () => FAKE_CONTEXT_RATE,
      session: failing === undefined ? Promise.resolve(made.session) : Promise.reject(failing),
      close: () => {
        made.closed = true;
        return Promise.resolve();
      },
    };
  };

  /** The session of the parts made last. */
  latest(): FakeSession {
    const last = this.opened.at(-1);
    if (last === undefined) throw new Error('No playback parts have been made.');
    return last.session;
  }
}

/** A render host that writes `chunks` to the output, one after another, and finishes. */
export class FakeRendering {
  /** Each chunk's channels, written in order to the graph's one sink. */
  chunks: readonly (readonly Float32Array[])[] = [];
  /** Hears each chunk written, once its progress has been reported. */
  onChunk: (() => void) | undefined;
  /** What the render finishes with, where a test wants it refused. */
  refusal: DomainResult<never> | undefined;
  /** What the render throws instead of answering, where a test wants a fault no code expected. */
  thrown: unknown;
  readonly requests: RenderRequest[] = [];
  /** What each render was run with: its priority above all. */
  readonly runs: RenderRunOptions[] = [];
  readonly interactive: boolean[] = [];
  readonly policies: SchedulingPolicy[] = [];
  readonly backgroundLimits: number[] = [];
  /** The settings the parts were first made with, one entry per making. */
  readonly openedWith: PerformanceSettings[] = [];
  opens = 0;

  readonly open = (settings: PerformanceSettings): Promise<DomainResult<RenderParts>> => {
    this.opens += 1;
    this.openedWith.push(settings);
    return Promise.resolve(succeed({ host: this.#host, scheduler: this.#scheduler }));
  };

  readonly #scheduler: RenderParts['scheduler'] = {
    setInteractive: (active) => {
      this.interactive.push(active);
    },
    setPolicy: (policy) => {
      this.policies.push(policy);
    },
    setBackgroundConcurrencyWhileInteractive: (limit) => {
      this.backgroundLimits.push(limit);
      return succeed(undefined);
    },
  };

  readonly #host: RenderHost = {
    render: async (request, run) => await this.#render(request, run),
  };

  async #render(
    request: RenderRequest,
    run: RenderRunOptions,
  ): Promise<DomainResult<WorkerRenderSummary>> {
    this.requests.push(request);
    this.runs.push(run);
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the fault stood in for is one that is not an Error
    if (this.thrown !== undefined) throw this.thrown;
    if (this.refusal !== undefined) return this.refusal;
    const [sink] = run.sinks.values();
    if (sink === undefined) return fail(failure('fake.no-sink', FailureKind.Rejected, 'No sink.'));
    let written = 0;
    for (const channels of this.chunks) {
      await sink.write(
        expectSuccess(frameBlock(StandardLayouts.stereo, request.sampleRate, channels)),
      );
      written += channels[0]?.length ?? 0;
      const progress: RenderProgress = {
        framesRendered: written,
        framesTotal: request.range.length,
      };
      run.onProgress?.(progress);
      this.onChunk?.();
    }
    return succeed({
      frames: request.range.length,
      latencyTrimmed: new Map(),
      conversions: [],
      dsp: DspImplementation.Reference,
      dspFallbackReason: 'This page cannot compile WebAssembly.',
    });
  }
}

/**
 * Waits for the Play asked for to settle, however many turns the modules it
 * loads the first time take.
 */
export async function playbackSettled(view: AudioViewStore): Promise<void> {
  await vi.waitFor(() => {
    if (view.get().starting) throw new Error('The Play has not settled.');
  }, PROMPTLY);
}
