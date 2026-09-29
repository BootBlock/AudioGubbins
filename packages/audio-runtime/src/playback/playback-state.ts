/**
 * The status playback publishes, and the transport inside it moved on the
 * context's clock.
 *
 * The transport's rules are the engine's `nextTransportState`; what is kept
 * here is where its frames come from. They are context frames of the
 * lifecycle's context, and the timeline runs at the context's rate, since
 * every source must already be at it (REQ-ARCH-085: a conversion is the
 * caller's, explicit). The context is taken when a command first needs one,
 * and the last is kept after a loss, since a transport that is not playing
 * reads no frame from it.
 */

import {
  ZERO_SAMPLES,
  flatMapResult,
  sampleRate,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  TransportMode,
  audibleFrame,
  nextTransportState,
  transportPosition,
  type MediaClock,
  type TransportEvent,
} from '@audiogubbins/audio-engine';

import type { AudioContextPort } from '../context/audio-context-port.js';
import type { ContextLifecycle } from '../context/context-lifecycle.js';
import { outputLatencyFrames } from '../context/device-report.js';
import { initialStatus, type PlaybackStatus } from './playback-status.js';

/** Hears every new status. */
export type PlaybackListener = (status: PlaybackStatus) => void;

/** The context the transport's frames are counted on, and its clock. */
export interface Timing {
  readonly port: AudioContextPort;
  readonly clock: MediaClock;
}

/** The context frame a context has reached: `currentTime` is frames over the rate. */
export function frameOf(port: AudioContextPort): number {
  return Math.round(port.currentTime * port.sampleRate);
}

/** The published status, and the transport moved on the context's clock. */
export class PlaybackState {
  readonly #lifecycle: ContextLifecycle;
  readonly #logger: Logger;
  readonly #listeners = new Set<PlaybackListener>();
  #status: PlaybackStatus;
  #timing: Timing | undefined;

  constructor(lifecycle: ContextLifecycle, logger: Logger) {
    this.#lifecycle = lifecycle;
    this.#logger = logger;
    this.#status = initialStatus(lifecycle.state);
  }

  get status(): PlaybackStatus {
    return this.#status;
  }

  /** Hears every status from now until the answer is called. */
  subscribe(listener: PlaybackListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Publishes `status`, with the context's state as it is now. */
  update(status: PlaybackStatus): void {
    this.#status = { ...status, contextState: this.#lifecycle.state };
    for (const listener of [...this.#listeners]) listener(this.#status);
  }

  /** Drops every listener. */
  clear(): void {
    this.#listeners.clear();
  }

  /** The lifecycle's context, made where there is none, as the transport's clock. */
  timing(): Timing {
    const port = this.#lifecycle.context();
    if (this.#timing?.port === port) return this.#timing;
    const rate = sampleRate(port.sampleRate);
    if (!rate.ok) {
      // A context's rate is a positive whole number of hertz by the Web Audio
      // specification, so one that is not is a broken host, not a person's
      // doing.
      throw new Error(`The audio context runs at ${String(port.sampleRate)} Hz, which is no rate.`);
    }
    this.#timing = { port, clock: { timelineRate: rate.value, contextRate: rate.value } };
    return this.#timing;
  }

  /** The context frame now, or zero before any context, when no frame matters yet. */
  frame(): number {
    return this.#timing === undefined ? 0 : frameOf(this.#timing.port);
  }

  /** Whether the transport is playing, or held by the system while playing. */
  isPlaying(): boolean {
    const mode = this.#status.transport.mode;
    return mode === TransportMode.Playing || mode === TransportMode.Suspended;
  }

  /** Moves the transport by `event`, or says why it cannot move. */
  apply(event: TransportEvent): DomainResult<void> {
    const clock = (this.#timing ?? this.timing()).clock;
    const next = nextTransportState(this.#status.transport, event, clock);
    if (!next.ok) return next;
    this.update({ ...this.#status, transport: next.value });
    return succeed(undefined);
  }

  /**
   * Moves the transport by what happened on the audio thread or to the
   * context. Such an event is a fact, not a request, so the transport's
   * refusal of one, a position past the largest count, is logged rather than
   * returned to anyone.
   */
  follow(event: TransportEvent): void {
    const moved = this.apply(event);
    if (moved.ok) return;
    this.#logger.warning('The transport could not follow what happened.', {
      event: event.kind,
      code: moved.failures[0].code,
    });
  }

  /** Pauses a transport that is playing, or held by the system, where it has reached. */
  pauseTransport(): void {
    if (this.isPlaying()) this.follow({ kind: 'pause', contextFrame: this.frame() });
  }

  /** The timeline frame playback has reached, as the engine has rendered it. */
  position(): DomainResult<SampleCount> {
    // No command has needed a context yet, so the transport is where it began.
    if (this.#timing === undefined) return succeed(ZERO_SAMPLES);
    return transportPosition(this.#status.transport, this.#timing.clock, this.frame());
  }

  /**
   * The timeline frame the listener hears now: the position less what the
   * graph adds, `graphLatencyFrames`, and what the device adds after it.
   */
  audiblePosition(graphLatencyFrames: number): DomainResult<SampleCount> {
    const timing = this.#timing;
    if (timing === undefined) return succeed(ZERO_SAMPLES);
    const report = this.#lifecycle.report;
    const behind = (report === undefined ? 0 : outputLatencyFrames(report)) + graphLatencyFrames;
    return flatMapResult(this.position(), (position) =>
      audibleFrame(timing.clock, position, behind),
    );
  }
}
