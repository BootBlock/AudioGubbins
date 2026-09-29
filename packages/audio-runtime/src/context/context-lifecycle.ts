/**
 * One audio context's life: made when first needed, run from the person's
 * gesture, suspended and resumed, and recovered when the system takes it away
 * or the device changes under it.
 *
 * Browsers start a context suspended until the page has been clicked or a key
 * pressed, so it is made lazily and resumed from Play. A browser does not
 * refuse a resume made without a gesture: it keeps the promise pending until
 * the page is clicked, perhaps for ever. So a resume is never awaited unbounded
 * (`context-resume.ts`). It succeeds when the context runs, and after a bounded
 * wait without that the lifecycle reports `awaiting-gesture`, a result the
 * caller shows rather than an exception, while the pending resume stays with
 * the browser, which completes it at the next click or key press. A context the
 * system suspends, for a call, a lock screen or a device unplugged, has stopped
 * the media clock without the transport's word, so each such suspension and the
 * return from it are reported with the context frame they happened at, which
 * the playback layer hands the transport as `context-suspended` and
 * `context-resumed`. Suspensions the runtime asked for are its own and reported
 * to no one.
 *
 * It decides nothing about playback and holds no graph: what to do about a
 * lost context or a new device is its listeners' to decide.
 */

import { fail, failure, FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { LatencyHint } from '@audiogubbins/audio-engine';

import {
  AudioContextState,
  type AudioContextPort,
  type CreateAudioContext,
} from './audio-context-port.js';
import { deviceReport, sameDeviceReport, type DeviceReport } from './device-report.js';
import { resumeFailure, resumeWithin } from './context-resume.js';
import { isDomException } from './dom-exception.js';
import type { Schedule } from '../schedule.js';

/** Where a context's life has reached. `idle` is before the first context is made. */
export const LifecycleState = {
  Idle: 'idle',
  Suspended: AudioContextState.Suspended,
  /**
   * Suspended, with a resume the browser holds until the page is clicked or
   * a key pressed, which then starts the context without being asked again.
   */
  AwaitingGesture: 'awaiting-gesture',
  Running: AudioContextState.Running,
  Interrupted: AudioContextState.Interrupted,
  Closed: AudioContextState.Closed,
} as const;

/** Where a context's life has reached. */
export type LifecycleState = (typeof LifecycleState)[keyof typeof LifecycleState];

/** What happened to the context that its listeners did not ask for. */
export const LifecycleEventKind = {
  /** The system suspended a running context. */
  SuspendedBySystem: 'suspended-by-system',
  /** A context the system suspended runs again. */
  Resumed: 'resumed',
  /** The context closed without being asked, and everything made in it is gone. */
  Lost: 'lost',
  /** What the device reports changed: another device, or its latency once it runs. */
  DeviceChanged: 'device-changed',
} as const;

/** What happened to the context that its listeners did not ask for. */
export type LifecycleEventKind = (typeof LifecycleEventKind)[keyof typeof LifecycleEventKind];

/** What happened to the context, at the context frame it happened. */
export type LifecycleEvent =
  | {
      readonly kind: typeof LifecycleEventKind.SuspendedBySystem;
      readonly contextFrame: number;
    }
  | { readonly kind: typeof LifecycleEventKind.Resumed; readonly contextFrame: number }
  | { readonly kind: typeof LifecycleEventKind.Lost }
  | { readonly kind: typeof LifecycleEventKind.DeviceChanged; readonly report: DeviceReport };

/** Hears what happens to the context. */
export type LifecycleListener = (event: LifecycleEvent) => void;

/** What a lifecycle is made from. */
export interface ContextLifecycleOptions {
  readonly createContext: CreateAudioContext;
  /** Calls `changed` when the audio devices change, and answers how to stop. */
  readonly watchDevices: (changed: () => void) => () => void;
  /** The performance profile's hint, which fixes the context's buffering for its life. */
  readonly latencyHint: LatencyHint;
  /** The rate to run at; the device's own where absent. */
  readonly sampleRate?: number;
  /** Bounds the wait on a resume. */
  readonly schedule: Schedule;
  readonly logger: Logger;
}

/**
 * The context frame a context has reached. `currentTime` is a count of frames
 * divided by the rate, so the nearest whole frame is the count.
 */
function contextFrameOf(port: AudioContextPort): number {
  return Math.round(port.currentTime * port.sampleRate);
}

/** A context and what was attached to it, released together. */
interface Attached {
  readonly port: AudioContextPort;
  readonly onStateChange: () => void;
  readonly stopWatchingDevices: () => void;
}

/** One audio context's lifecycle, a context at a time, each made when first needed. */
export class ContextLifecycle {
  readonly #options: ContextLifecycleOptions;
  readonly #listeners = new Set<LifecycleListener>();
  #attached: Attached | undefined;
  #report: DeviceReport | undefined;
  /** Whether the last context ended, by loss or by `close`, with none made since. */
  #ended = false;
  #closedForGood = false;
  /** The state the last `statechange` left, to tell a suspension of a running context. */
  #lastState: AudioContextState = AudioContextState.Suspended;
  #suspendedByUs = false;
  #suspendedBySystem = false;
  /** Whether a resume outlasted its wait on a suspended context, which then waits for a gesture. */
  #awaitingGesture = false;

  constructor(options: ContextLifecycleOptions) {
    this.#options = options;
  }

  /** Where the context's life has reached. */
  get state(): LifecycleState {
    if (this.#attached !== undefined) {
      const state = this.#attached.port.state;
      return this.#awaitingGesture && state === AudioContextState.Suspended
        ? LifecycleState.AwaitingGesture
        : state;
    }
    return this.#ended ? LifecycleState.Closed : LifecycleState.Idle;
  }

  /** What the device last reported, or `undefined` before a context is made. */
  get report(): DeviceReport | undefined {
    return this.#report;
  }

  /**
   * The context, made now if there is none or the last was lost. It may be
   * suspended until `ensureRunning` is called from a gesture.
   */
  context(): AudioContextPort {
    if (this.#closedForGood) {
      // A wiring mistake, not something the person did: a closed lifecycle
      // is never handed out again.
      throw new Error('This audio context lifecycle was closed; create another.');
    }
    return (this.#attached ?? this.#open()).port;
  }

  /**
   * The context, running. Called from the person's Play, since browsers
   * resume a context only from a click or a key press.
   */
  async ensureRunning(): Promise<DomainResult<AudioContextPort>> {
    const port = this.context();
    if (port.state === AudioContextState.Running) return succeed(port);
    this.#suspendedByUs = false;
    const resumed = await this.#resume(port);
    if (!resumed.ok) {
      this.#options.logger.warning('The audio context did not start.', {
        code: resumed.failures[0].code,
        state: port.state,
      });
      return resumed;
    }
    return succeed(port);
  }

  /** Suspends the context on the runtime's own word, which no listener is told of. */
  async suspend(): Promise<DomainResult<undefined>> {
    const port = this.#attached?.port;
    if (port === undefined || port.state === AudioContextState.Closed) return succeed(undefined);
    // Ours from now, so the state change it brings is not reported, and a
    // system suspension it replaces is not resumed from on a device change.
    this.#suspendedByUs = true;
    this.#suspendedBySystem = false;
    this.#awaitingGesture = false;
    try {
      await port.suspend();
    } catch (error) {
      // Refused only by a context that closed meanwhile (InvalidStateError),
      // whose loss the state change reports. Anything else is a fault.
      if (!isDomException(error, 'InvalidStateError')) throw error;
      const reason = error.message;
      return fail(
        failure(
          'audio.context-suspend-failed',
          FailureKind.Conflict,
          'The audio context could not be suspended because it has closed.',
          { details: { reason } },
        ),
      );
    }
    return succeed(undefined);
  }

  /** Hears every event from now until the answer is called. */
  subscribe(listener: LifecycleListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Stops watching, drops every listener and closes the context, for good. */
  async close(): Promise<void> {
    this.#closedForGood = true;
    this.#listeners.clear();
    const attached = this.#attached;
    this.#ended = true;
    if (attached === undefined) return;
    this.#detach(attached);
    if (attached.port.state === AudioContextState.Closed) return;
    try {
      await attached.port.close();
    } catch (error) {
      // Refused only by a context the browser closed first
      // (InvalidStateError), which leaves it as closed as asked. Anything
      // else is a fault.
      if (!isDomException(error, 'InvalidStateError')) throw error;
      this.#options.logger.debug('The audio context had already closed.', {
        reason: error.message,
      });
    }
  }

  #open(): Attached {
    const { createContext, latencyHint, sampleRate, watchDevices, logger } = this.#options;
    const port = createContext({
      latencyHint,
      ...(sampleRate === undefined ? {} : { sampleRate }),
    });
    this.#lastState = port.state;
    this.#suspendedByUs = false;
    this.#suspendedBySystem = false;
    this.#awaitingGesture = false;
    this.#ended = false;
    this.#report = deviceReport(port);

    // Each ignores a context no longer attached, whose events can still be on
    // their way after it is detached.
    const onStateChange = (): void => {
      if (this.#attached?.port === port) this.#stateChanged(port);
    };
    port.addEventListener('statechange', onStateChange);
    const attached: Attached = {
      port,
      onStateChange,
      stopWatchingDevices: watchDevices(() => {
        if (this.#attached?.port === port) this.#devicesChanged(port);
      }),
    };
    this.#attached = attached;
    logger.info('Created the audio context.', {
      state: port.state,
      sampleRate: port.sampleRate,
      latencyHint,
    });
    return attached;
  }

  #stateChanged(port: AudioContextPort): void {
    const previous = this.#lastState;
    const state = port.state;
    this.#lastState = state;
    switch (state) {
      case AudioContextState.Running:
        this.#runs(port);
        return;
      case AudioContextState.Suspended:
      case AudioContextState.Interrupted:
        if (previous === AudioContextState.Running && !this.#suspendedByUs) {
          this.#suspendedBySystem = true;
          this.#options.logger.info('The system suspended the audio context.', { state });
          this.#emit({
            kind: LifecycleEventKind.SuspendedBySystem,
            contextFrame: contextFrameOf(port),
          });
        }
        return;
      case AudioContextState.Closed:
        if (this.#attached !== undefined) this.#detach(this.#attached);
        this.#options.logger.warning('The audio context closed without being asked to.');
        this.#emit({ kind: LifecycleEventKind.Lost });
        return;
    }
  }

  #runs(port: AudioContextPort): void {
    this.#suspendedByUs = false;
    this.#awaitingGesture = false;
    if (this.#suspendedBySystem) {
      this.#suspendedBySystem = false;
      this.#options.logger.info('The audio context runs again after the system suspended it.');
      this.#emit({ kind: LifecycleEventKind.Resumed, contextFrame: contextFrameOf(port) });
    }
    // Browsers report the output latency only once audio flows.
    this.#refreshReport(port);
  }

  #devicesChanged(port: AudioContextPort): void {
    this.#refreshReport(port);
    // Once per change: a device that keeps the context held is not retried
    // until the devices change again or the person presses Play.
    if (this.#suspendedBySystem) void this.#recoverAfterDeviceChange(port);
  }

  async #recoverAfterDeviceChange(port: AudioContextPort): Promise<void> {
    const { logger } = this.#options;
    logger.info('Resuming the audio context after the audio devices changed.');
    const resumed = await this.#resume(port);
    if (resumed.ok) {
      logger.info('The audio context resumed after the audio devices changed.');
      return;
    }
    logger.warning('The audio context could not resume after the audio devices changed.', {
      code: resumed.failures[0].code,
      reason: resumed.failures[0].summary,
    });
  }

  /** Resumes `port`, waiting a bounded time, and says why where it did not run. */
  async #resume(port: AudioContextPort): Promise<DomainResult<undefined>> {
    const outcome = await resumeWithin(port, this.#options.schedule);
    if (outcome.kind === 'running') return succeed(undefined);
    // Waiting for a gesture from now until the context runs, unless it ran,
    // closed or was replaced while this was on its way here.
    const stillWaiting =
      this.#attached?.port === port && port.state === AudioContextState.Suspended;
    if (outcome.kind === 'awaiting-gesture' && stillWaiting) this.#awaitingGesture = true;
    return resumeFailure(outcome);
  }

  #refreshReport(port: AudioContextPort): void {
    const next = deviceReport(port);
    if (this.#report !== undefined && sameDeviceReport(this.#report, next)) return;
    this.#report = next;
    this.#emit({ kind: LifecycleEventKind.DeviceChanged, report: next });
  }

  #detach(attached: Attached): void {
    this.#awaitingGesture = false;
    attached.port.removeEventListener('statechange', attached.onStateChange);
    attached.stopWatchingDevices();
    if (this.#attached === attached) this.#attached = undefined;
    this.#ended = true;
  }

  #emit(event: LifecycleEvent): void {
    // A copy, so a listener that unsubscribes while hearing an event does not
    // make the one after it miss it.
    for (const listener of [...this.#listeners]) listener(event);
  }
}
