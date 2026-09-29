/**
 * Playback of one graph at a time through the engine's AudioWorklet
 * processor: the main thread's side, which the interface's Play, Pause, Stop
 * and seek reach.
 *
 * The main thread holds no audio. The feeder worker reads the sources and
 * feeds the processor directly, and the processor counts where playback is;
 * what is left here is the person's commands and what the threads report.
 *
 * It wires parts that each keep one rule and decides none of theirs. The
 * graph in the processor, its loading and its loss, is `GraphLoader`'s, and
 * what each reply means is `ProcessorReplies`'s; the runs are
 * `ProcessorRuns`'s; the published status and the transport's clock are
 * `PlaybackState`'s, whose rules are the engine's `nextTransportState`; the
 * context's life is the lifecycle's. What is left is the order of things:
 * what each command does, and which transport event each lifecycle event is.
 *
 * Real-time playback is not canonical (ADR-0032): what the browser does after
 * the processor's output, its resampling and mixing to the device, is outside
 * it.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  TransportMode,
  type PerformanceProfile,
  type PerformanceSettings,
} from '@audiogubbins/audio-engine';

import {
  LifecycleEventKind,
  type ContextLifecycle,
  type LifecycleEvent,
} from '../context/context-lifecycle.js';
import { deviceChannelsFor } from '../context/device-channels.js';
import type { DeviceReport } from '../context/device-report.js';
import type { CompiledDspModule, DspDelivery } from '../dsp/dsp-delivery.js';
import { ToProcessorKind } from '../protocol/processor-messages.js';
import type { Schedule } from '../schedule.js';
import { GraphLoader, summaries, type PlaybackThreads } from './graph-loader.js';
import type { LoadedProcessor } from './loaded-processor.js';
import type { PlaybackRequest } from './playback-preparation.js';
import { PlaybackState, type PlaybackListener } from './playback-state.js';
import {
  PlaybackPhase,
  faultedStatus,
  unloadedStatus,
  type MeterLevels,
  type PlaybackStatus,
} from './playback-status.js';
import { superseded } from './superseded.js';

// The request a session loads and the listener it takes are part of its
// contract, whichever module defines them.
export type { PlaybackListener, PlaybackRequest };

/** What the person is told when the audio context goes away under playback. */
const LOST_PROBLEM =
  'The audio output stopped because the browser closed the audio device. Press Play to start again.';

/** What a session plays with. */
export interface PlaybackSessionOptions {
  readonly lifecycle: ContextLifecycle;
  readonly capabilities: AudioRuntimeCapabilities;
  /** The canonical DSP module, for the worklet and the feeder, or why there is none. */
  readonly dsp: DspDelivery<CompiledDspModule>;
  /** The profile the person chose, which the stability verdict recommends from. */
  readonly profile: PerformanceProfile;
  /** The profile's settings, which set how far ahead the feeds keep. */
  readonly settings: PerformanceSettings;
  /** Where the bundler put the processor's module (`threads/engine-processor.ts`). */
  readonly workletModuleUrl: string;
  /** Starts the feeder worker and makes the channel between it and the processor. */
  readonly threads: PlaybackThreads;
  /** Calls a callback after a delay, and answers how to cancel it; `setTimeout` in production. */
  readonly schedule: Schedule;
  readonly logger: Logger;
}

function playbackFailure(code: string, kind: FailureKind, summary: string): DomainResult<never> {
  return fail(failure(code, kind, summary));
}

/** Plays one graph at a time through the engine's processor. */
export class PlaybackSession {
  readonly #lifecycle: ContextLifecycle;
  readonly #state: PlaybackState;
  readonly #graph: GraphLoader;
  readonly #stopListening: () => void;
  /** Counts the person's transport commands, so an awaited one that another overtook stands down. */
  #commands = 0;
  #disposed = false;

  constructor(options: PlaybackSessionOptions) {
    this.#lifecycle = options.lifecycle;
    this.#state = new PlaybackState(options.lifecycle, options.logger);
    this.#graph = new GraphLoader({
      ...options,
      state: this.#state,
      faulted: (problem) => {
        this.#fault(problem);
      },
    });
    this.#stopListening = options.lifecycle.subscribe(this.#lifecycleEvent);
  }

  /** What playback is doing now. */
  get status(): PlaybackStatus {
    return this.#state.status;
  }

  /** Hears every status from now until the answer is called. */
  subscribe(listener: PlaybackListener): () => void {
    return this.#state.subscribe(listener);
  }

  /**
   * Loads a graph into the processor, replacing the one it had, and settles
   * when the processor has it, has refused it, or has not answered in time. A
   * graph that cannot play is refused before any node is made. A transport
   * that was playing is paused where it was.
   */
  async load(request: PlaybackRequest): Promise<DomainResult<void>> {
    this.#assertLive();
    this.#commands += 1;
    this.#state.pauseTransport();
    this.#state.clearMeters();
    return await this.#graph.load(request);
  }

  /**
   * Plays from the transport's position. Called from the person's gesture,
   * which is what lets the browser start the audio context; a refusal is
   * returned for the interface to show. After the context was lost, the last
   * graph is loaded again first.
   */
  async play(): Promise<DomainResult<void>> {
    this.#assertLive();
    const lost = this.#graph.lostRequest;
    if (this.status.phase === PlaybackPhase.Unloaded && lost !== undefined) {
      const reloaded = await this.load(lost);
      if (!reloaded.ok) return reloaded;
    }
    const loaded = this.#graph.current;
    if (loaded === undefined || this.status.phase !== PlaybackPhase.Ready) return this.#notReady();
    this.#commands += 1;
    const command = this.#commands;
    const running = await this.#lifecycle.ensureRunning();
    this.#state.update(this.status);
    if (!running.ok) return running;
    if (command !== this.#commands || this.#graph.current !== loaded) return this.#superseded();
    // Held by the system, or already on its way: the context running again is
    // all Play can add, and the lifecycle's `resumed` moves the transport.
    const transport = this.status.transport;
    if (transport.mode === TransportMode.Playing || transport.mode === TransportMode.Suspended) {
      return succeed(undefined);
    }
    if (loaded.runs.starting) return succeed(undefined);
    // Paused, the processor holds the audio and the graph's history, and goes
    // on with the very next frame.
    if (transport.mode === TransportMode.Paused && loaded.runs.resume(transport.position)) {
      return succeed(undefined);
    }
    return await this.#startFrom(loaded, command, transport.position);
  }

  /**
   * Pauses where playback is, or cancels a play on its way. The transport
   * pauses where the clock puts it now, and settles where the processor says
   * it halted once it has.
   */
  pause(): DomainResult<void> {
    this.#assertLive();
    this.#commands += 1;
    const runs = this.#graph.current?.runs;
    const wasStarting = runs?.starting ?? false;
    runs?.pause();
    if (wasStarting && !this.#state.isPlaying()) return succeed(undefined);
    return this.#state.apply({ kind: 'pause', contextFrame: this.#state.frame() });
  }

  /** Stops, and returns to where the last play started. */
  stop(): DomainResult<void> {
    this.#assertLive();
    this.#commands += 1;
    this.#graph.current?.runs.stop();
    return this.#state.apply({ kind: 'stop' });
  }

  /**
   * Moves to timeline frame `to`. Playback that was running, or on its way,
   * goes on from there once the feeds are rewound and fed afresh.
   */
  async seek(to: SampleCount): Promise<DomainResult<void>> {
    this.#assertLive();
    this.#commands += 1;
    const command = this.#commands;
    const loaded = this.#graph.current;
    const resume = this.#state.isPlaying() || (loaded?.runs.starting ?? false);
    loaded?.runs.stop();
    // Paused first, so the play the processor's `started` brings anchors the
    // clock where the new audio begins rather than where the seek was asked.
    if (this.status.transport.mode === TransportMode.Playing) {
      const paused = this.#state.apply({ kind: 'pause', contextFrame: this.#state.frame() });
      if (!paused.ok) return paused;
    }
    const moved = this.#state.apply({ kind: 'seek', to, contextFrame: this.#state.frame() });
    if (!moved.ok || !resume || loaded === undefined) return moved;
    return await this.#startFrom(loaded, command, to);
  }

  /**
   * Sets a parameter of a node of the loaded graph. The node checks the value
   * on the audio thread, and a refusal arrives later as a problem in the
   * status; refused here only when no graph is loaded to take it.
   */
  setParameter(node: NodeId, name: string, value: number): DomainResult<void> {
    this.#assertLive();
    const loaded = this.#graph.current;
    if (loaded === undefined || this.status.phase !== PlaybackPhase.Ready) return this.#notReady();
    loaded.link.send({ kind: ToProcessorKind.SetParameter, node, name, value });
    return succeed(undefined);
  }

  /**
   * The timeline frame playback has reached: the processor's count when
   * paused or stopped, and while playing its last count carried on by the
   * context's clock, which is good for a playhead and nothing else.
   */
  position(): DomainResult<SampleCount> {
    return this.#state.position();
  }

  /**
   * The timeline frame the listener hears now: the position less what the
   * device adds after the output, for a playhead (REQ-ARCH-144).
   */
  audiblePosition(): DomainResult<SampleCount> {
    return this.#state.audiblePosition();
  }

  /** Each meter's latest levels, read where they are shown rather than published. */
  meters(): ReadonlyMap<NodeId, MeterLevels> {
    return this.#state.meters;
  }

  /** Releases everything the session made, the feeder worker with it. */
  dispose(): void {
    if (this.#disposed) return;
    this.#commands += 1;
    this.#graph.dispose();
    this.#disposed = true;
    this.#stopListening();
    this.#state.clear();
  }

  /** Starts a run from `from`, unless another command overtakes it while the feeds prime. */
  async #startFrom(
    loaded: LoadedProcessor,
    command: number,
    from: SampleCount,
  ): Promise<DomainResult<void>> {
    const started = await loaded.runs.start(from);
    if (!started.ok) {
      this.#fault(summaries(started.failures).join(' '));
      return started;
    }
    if (started.value && command === this.#commands) return succeed(undefined);
    // A feed that failed while priming ended the run as a fault, not a command.
    if (this.#graph.current === loaded && this.status.phase === PlaybackPhase.Faulted) {
      return playbackFailure(
        'playback.processor-fault',
        FailureKind.Rejected,
        this.status.problems.join(' '),
      );
    }
    return this.#superseded();
  }

  /** Processing cannot go on: the run ends, the transport pauses where it was, and the person is told. */
  #fault(problem: string): void {
    const loaded = this.#graph.current;
    loaded?.runs.stop();
    this.#state.pauseTransport();
    this.#state.clearMeters();
    this.#state.update(faultedStatus(this.status, problem));
    loaded?.abandon(fail(failure('playback.processor-fault', FailureKind.Rejected, problem)));
  }

  readonly #lifecycleEvent = (event: LifecycleEvent): void => {
    switch (event.kind) {
      case LifecycleEventKind.SuspendedBySystem:
        this.#state.follow({ kind: 'context-suspended', contextFrame: event.contextFrame });
        return;
      case LifecycleEventKind.Resumed:
        this.#state.follow({ kind: 'context-resumed', contextFrame: event.contextFrame });
        return;
      case LifecycleEventKind.DeviceChanged:
        this.#state.update({ ...this.status, device: event.report });
        this.#checkDevice(event.report);
        return;
      case LifecycleEventKind.StateChanged:
        // The status carries the lifecycle's state as it is when published.
        this.#state.update(this.status);
        return;
      case LifecycleEventKind.Lost:
        // The node and its feeds went with the context. The transport pauses
        // at the last frame the context reached, so Play, which loads the
        // graph again on a new context, goes on from there.
        this.#commands += 1;
        this.#state.pauseTransport();
        this.#graph.lost(LOST_PROBLEM);
        this.#state.clearMeters();
        this.#state.update(unloadedStatus(this.status, LOST_PROBLEM));
        return;
    }
  };

  /**
   * Stops with the reason where the device the context now plays to cannot
   * take every channel of the loaded graph's output, which it would drop.
   */
  #checkDevice(report: DeviceReport): void {
    const loaded = this.#graph.current;
    if (loaded === undefined || this.status.phase === PlaybackPhase.Faulted) return;
    const fits = deviceChannelsFor(loaded.prepared.sinkLayout, report.maxChannelCount);
    if (!fits.ok) this.#fault(fits.failures[0].summary);
  }

  #notReady(): DomainResult<never> {
    return playbackFailure(
      'playback.not-ready',
      FailureKind.Conflict,
      `Nothing is ready to play: playback is ${this.status.phase}.`,
    );
  }

  #superseded(): DomainResult<never> {
    return superseded('Another playback command came first, so this one stood down.');
  }

  #assertLive(): void {
    if (this.#disposed) {
      // A wiring mistake: a disposed session has let go of its node and context.
      throw new Error('This playback session was disposed; create another.');
    }
  }
}
