/**
 * The input side of recording (`ADR-0070`, `REQ-REC-090`): the recording
 * session's state machine driven by what the browser and the capture processor
 * do, and the input it opens and closes.
 *
 * Nothing is asked of the browser at start-up. An input is opened only when the
 * person arms it, and the permission is asked for then; it is closed when they
 * disarm it, and whenever the session no longer holds one, whatever ended it:
 * the device lost, the permission taken back, the context closed under it. What
 * it records for, and how to read whether this tab may write into the project,
 * are given with each arming by whoever arms (`ArmRequest`), since a project's
 * takes and its write lease are the project's; the lease is read again when an
 * armed input opens again. A take is made through its `takes`
 * (`take-capture.ts`), and the capture channel Record answers is the caller's
 * to hand to the storage worker. Monitoring is the monitoring control's, which
 * this tells when an input opens and closes, and never because one was armed.
 * The status bar says each change of the input's state; this says why an input
 * closed or would not open, and the levels after a passage.
 */

import {
  FailureKind,
  derivedSampleCount,
  failure,
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { CaptureSessionEvent, InputMeterReport } from '@audiogubbins/audio-runtime';
import type { MicrophonePermission, ResourceFigures } from '@audiogubbins/capabilities';
import {
  inputIsOpen,
  nextSession,
  type ArmedPurpose,
  type DeviceIdentity,
  type RecordingSession,
  type SessionEvent,
  type SessionSetup,
} from '@audiogubbins/recording';

import type { AudioSettingsStore } from '../state/audio-settings-store.js';
import { observable, type Observable } from '../state/observable.js';
import { chosenProfileOf, rememberInput } from '../state/recording-settings.js';
import { armBuffer } from './buffer-arming.js';
import { DeviceWatch } from './device-watch.js';
import {
  joinContext,
  openInput,
  type InputOpening,
  type OpenedCapture,
  type OpeningAdmission,
} from './input-opener.js';
import { contextReplacedText } from './recording-words.js';
import type { ContextHold } from '../audio/context-host.js';
import { NOTHING_ASKED, type InputView } from './input-view.js';
import type { LevelSummary } from './level-summary.js';
import type { MonitoringControl } from './monitoring-control.js';
import {
  BROWSER_DEFAULT_INPUT,
  armEvent,
  armFailure,
  devicesFollowing,
  openedSession,
  permissionFollowing,
  reopenFailure,
  followedOf,
  followingEvents,
  setupOf,
  type ArmRequest,
  type Followed,
  type Following,
} from './session-setup.js';
import { watchOpenInput, type PageWatch } from './open-input-watch.js';
import { TakeCapture } from './take-capture.js';
import { outputIdentityOf } from './system-output.js';

/** What the input control is made with. */
export interface InputControlOptions {
  readonly opening: InputOpening;
  readonly settings: AudioSettingsStore;
  readonly monitoring: MonitoringControl;
  readonly page: PageWatch;
  /** Whether this platform may suspend capture in the background or under a screen lock. */
  readonly suspensionRisk: boolean;
  /** What the machine has left, read afresh each time the retrospective buffer is armed. */
  readonly resources: () => ResourceFigures;
  readonly announce: (text: string) => void;
  readonly logger: Logger;
}

/** The input open now, and what watches it. */
interface Open {
  readonly opened: OpenedCapture;
  readonly stopWatching: () => void;
  readonly levels: LevelSummary;
}

function problemOf(code: string, summary: string): DomainFailure {
  return failure(code, FailureKind.Rejected, summary);
}

/** Drives the recording session and opens and closes its input. */
export class InputControl {
  readonly #options: InputControlOptions;
  readonly #view = observable(NOTHING_ASKED);
  readonly #devices: DeviceWatch;
  readonly #stopFollowingSettings: () => void;
  readonly #listeners = new Set<(event: CaptureSessionEvent) => void>();
  #open: Open | undefined;
  /** Counts openings, so one overtaken by a disarm or another opening closes what it opened. */
  #attempt = 0;
  #followed: Followed;
  /**
   * How the last arming reads the write lease, read again when the armed
   * input opens again; before any arming, no lease is known to be held.
   */
  #lease: () => boolean = () => false;
  /** The take a Record makes on the input open now. */
  readonly takes: TakeCapture;

  constructor(options: InputControlOptions) {
    this.#options = options;
    this.takes = new TakeCapture({
      session: () => this.#view.get().session,
      dispatch: (event) => this.#dispatch(event),
      open: () => {
        const open = this.#open;
        return open === undefined
          ? undefined
          : { capture: open.opened.capture, rate: open.opened.facts.rate };
      },
      bufferedSeconds: () => this.#view.get().bufferedSeconds,
      contextFrame: () => this.contextFrame(),
    });
    this.#devices = new DeviceWatch(options.opening.media, {
      permission: this.#permissionChanged,
      devices: this.#devicesChanged,
      output: (described) => {
        const output = outputIdentityOf(described);
        this.#update({ output });
        options.monitoring.outputChanged(output);
      },
      refused: (refusal) => {
        this.#update({ listing: { kind: 'refused', failure: refusal } });
      },
    });
    this.#followed = followedOf(options.settings.get().recording);
    this.#stopFollowingSettings = options.settings.subscribe(this.#settingsChanged);
  }

  /** What the views read. */
  get view(): Observable<InputView> {
    return this.#view;
  }

  /** Watches the permission and the inputs until the answer is called (`device-watch.ts`). */
  watchDevices(): () => void {
    return this.#devices.watch();
  }

  /** Hears every event of the capture session of the input open now, until the answer is called. */
  subscribeCapture(listener: (event: CaptureSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Arms the input for `request`, asking for the permission where it is not
   * held, or answers why it cannot. Run from the person's gesture: the context
   * is started before anything is awaited. The input opens after; its arming,
   * or the reason it did not open, is said then. `admit`, where given, is
   * asked once the context is joined and before the browser is asked for the
   * input; a reason it answers ends the arming, and no input is opened.
   */
  arm(request: ArmRequest, admit?: OpeningAdmission): DomainResult<void> {
    const refusal = this.#armFailure(request);
    if (refusal !== undefined) return fail(refusal);
    const { session } = this.#view.get();
    if (session.kind !== 'ready') {
      const asking = this.#dispatch({ kind: 'permission-asked' });
      if (!asking.ok) return asking;
    } else {
      // With no input chosen, the browser's default is armed, and the input
      // it opens is remembered as the chosen one.
      if (session.device === undefined) {
        const chosen = this.#dispatch({ kind: 'device-chosen', device: BROWSER_DEFAULT_INPUT });
        if (!chosen.ok) return chosen;
      }
      const armed = this.#dispatch(armEvent(request));
      if (!armed.ok) return armed;
    }
    this.#lease = request.holdsWriteLease;
    this.#update({ problem: undefined });
    this.#begin(request, admit);
    return succeed(undefined);
  }

  /**
   * Why the input cannot be armed for `request` now, or nothing where it can:
   * the session is asked as it would stand once ready, so a tab without the
   * write lease, or a purpose the session refuses, is told why before the
   * browser is asked anything.
   */
  armRefusal(request: ArmRequest): string | undefined {
    return this.#armFailure(request)?.summary;
  }

  #armFailure(request: ArmRequest): DomainFailure | undefined {
    return armFailure(this.#view.get().session, this.#setup(), request);
  }

  /** The input's last levels, read where they are drawn, once a display frame. */
  meters(): InputMeterReport | undefined {
    return this.#open?.opened.capture.meters();
  }

  /** The input's levels in words, now and as they peaked since last said, or why there are none. */
  sayLevels(): DomainResult<string> {
    const open = this.#open;
    return open === undefined
      ? fail(problemOf('recording.no-input', 'No input is open, so there are no levels to say.'))
      : succeed(open.levels.say());
  }

  /** Disarms the input: it closes, and its retrospective buffer is overwritten with zeros. */
  disarm(): DomainResult<void> {
    return this.#dispatch({ kind: 'disarm' });
  }

  /** Chooses `device` as the input, remembering it; an armed input opens again with it. */
  chooseDevice(device: DeviceIdentity): DomainResult<void> {
    const { session } = this.#view.get();
    this.#options.settings.reviseRecording(rememberInput(device));
    if (session.kind !== 'ready' && session.kind !== 'armed') return succeed(undefined);
    return this.#dispatch({ kind: 'device-chosen', device });
  }

  /** Gives the armed input another purpose: what the next take is recorded for. */
  retarget(purpose: ArmedPurpose): DomainResult<void> {
    return this.#dispatch({ kind: 'retarget', purpose });
  }

  /** What was captured is finished: the caller's storage has ended the take. */
  stopped(): DomainResult<void> {
    return this.#dispatch({ kind: 'stopped' });
  }

  /** The context frame now, where an input is open: what Record and Stop are given. */
  contextFrame(): SampleCount | undefined {
    const port = this.#open?.opened.lifecycle.context();
    return port?.ok === true
      ? derivedSampleCount(Math.round(port.value.currentTime * port.value.sampleRate))
      : undefined;
  }

  /** Closes the input and stops watching, for good. */
  dispose(): void {
    this.#attempt += 1;
    this.#close();
    this.#stopFollowingSettings();
    this.#listeners.clear();
  }

  /** The setup a session is made ready with: the remembered input, found again, the profile and the buffer. */
  #setup(): SessionSetup {
    return setupOf(this.#options.settings.get().recording, this.#view.get().devices);
  }

  /**
   * Opens the input the session or the setup names, for `request`: the context
   * is joined before any input open now is closed, so a context nothing else
   * holds is kept running for the input that replaces it.
   */
  #begin(request: ArmRequest, admit?: OpeningAdmission): void {
    this.#attempt += 1;
    const attempt = this.#attempt;
    const hold = joinContext(this.#options.opening, {
      // The context is being closed for another, and the input goes with it.
      replaced: (why) => {
        if (attempt !== this.#attempt) return;
        const problem = contextReplacedText(why);
        const failure = problemOf('recording.context-replaced', problem);
        this.#lost({ kind: 'failed', failure }, problem);
      },
    });
    this.#close();
    void this.#openWith(request, hold, attempt, admit);
  }

  async #openWith(
    request: ArmRequest,
    hold: ContextHold,
    attempt: number,
    admit: OpeningAdmission | undefined,
  ): Promise<void> {
    const { session, devices } = this.#view.get();
    const device = session.kind === 'armed' ? session.device : this.#setup().device;
    const profile = chosenProfileOf(this.#options.settings.get().recording);
    const opened = await openInput(
      this.#options.opening,
      { device, profile, devices, ...(admit === undefined ? {} : { admit }) },
      hold,
    );
    if (attempt !== this.#attempt) {
      if (opened.ok) opened.value.close();
      return;
    }
    if (opened.ok) this.#opened(opened.value, request);
    else this.#notOpened(opened.failures[0]);
  }

  /** Takes the session through to an open, armed input, or closes it again with the reason. */
  #opened(opened: OpenedCapture, request: ArmRequest): void {
    const { facts } = opened;
    const { session, refusal } = openedSession(
      this.#view.get().session,
      this.#setup(),
      facts,
      request,
    );
    if (refusal !== undefined) {
      opened.close();
      this.#update({ session });
      this.#tell(refusal.summary);
      return;
    }
    this.#options.settings.reviseRecording(rememberInput(facts.device));
    this.#devices.relist();
    this.#adopt(opened);
    this.#update({ session, opened: facts, bufferedSeconds: 0, problem: undefined });
    this.#armCapture();
    this.#options.monitoring.inputOpened(
      opened.capture,
      facts,
      chosenProfileOf(this.#options.settings.get().recording),
    );
  }

  /** The input would not open: the session says why, and so is the person told. */
  #notOpened(reason: DomainFailure): void {
    const { session } = this.#view.get();
    const event: SessionEvent =
      session.kind === 'asking' && reason.code === 'media-input.not-allowed'
        ? { kind: 'permission-denied' }
        : { kind: 'failed', failure: reason };
    if (session.kind === 'asking' || session.kind === 'armed') this.#dispatch(event);
    this.#tell(reason.summary);
  }

  /** Holds `opened` as the input open now, watching its track, its capture and the page. */
  #adopt(opened: OpenedCapture): void {
    const watch = watchOpenInput(
      opened,
      this.#options.page,
      this.#options.suspensionRisk,
      {
        event: (event) => {
          this.takes.heard(event);
          for (const listener of [...this.#listeners]) listener(event);
        },
        deviceLost: () => {
          this.#lost({ kind: 'device-lost' }, 'The input was disconnected, so it closed.');
        },
        failed: (failure, problem) => {
          this.#lost({ kind: 'failed', failure }, problem);
        },
        suspended: (why) => {
          this.#suspended(why);
        },
        muted: (muted) => {
          const facts = this.#view.get().opened;
          if (facts !== undefined) this.#update({ opened: { ...facts, muted } });
        },
        buffered: (bufferedSeconds) => {
          if (bufferedSeconds !== this.#view.get().bufferedSeconds)
            this.#update({ bufferedSeconds });
        },
        monitoring: (reply) => {
          this.#options.monitoring.heard(reply);
        },
        context: (context) => {
          this.#update({ context });
        },
        say: this.#options.announce,
      },
      this.#options.logger,
    );
    const stopListing = this.#devices.watch();
    this.#open = {
      opened,
      stopWatching: () => {
        watch.stop();
        stopListing();
      },
      levels: watch.levels,
    };
    this.#update({ context: opened.lifecycle.report });
  }

  /**
   * Arms the capture with the retrospective buffer the session has, as much of
   * it as the memory the page has left allows (`buffer-arming.ts`), or none.
   */
  #armCapture(): void {
    const { session } = this.#view.get();
    const open = this.#open;
    if (open === undefined || session.kind !== 'armed') return;
    const armed = armBuffer(open.opened, session.retrospective, this.#options);
    if (armed.ok) this.#update({ buffer: armed.value });
    else this.#lost({ kind: 'failed', failure: armed.failures[0] }, armed.failures[0].summary);
  }

  /** Moves the session by `event`, and closes the input where the session no longer holds one. */
  #dispatch(event: SessionEvent): DomainResult<void> {
    const before = this.#view.get().session;
    const moved = nextSession(before, event);
    if (!moved.ok) return moved;
    this.#update({ session: moved.value });
    this.#settle(before, moved.value);
    return succeed(undefined);
  }

  /**
   * Keeps the input in step with the session: opened again where an armed
   * session asks for another device or profile, and closed, with any opening on
   * its way given up, where the session neither holds nor opens one.
   */
  #settle(before: RecordingSession, after: RecordingSession): void {
    const opening = after.kind === 'armed' && after.input.kind === 'opening';
    if (opening && before.kind === 'armed' && before.input.kind === 'open') {
      this.#reopen(after, { purpose: after.purpose, holdsWriteLease: this.#lease });
      return;
    }
    if (inputIsOpen(after) || after.kind === 'armed' || after.kind === 'asking') return;
    this.#attempt += 1;
    this.#close();
  }

  /**
   * Opens an armed input again, for another device or profile, where the
   * session would still arm it now: an opening is an arming, so the session's
   * own rules, the write lease among them, are asked again. Where it refuses,
   * the input is disarmed instead, and the person told why.
   */
  #reopen(armed: Extract<RecordingSession, { kind: 'armed' }>, request: ArmRequest): void {
    const refusal = reopenFailure(armed, request);
    if (refusal === undefined) this.#begin(request);
    else this.#lost({ kind: 'failed', failure: refusal }, refusal.summary);
  }

  #close(): void {
    const open = this.#open;
    this.#open = undefined;
    this.takes.forget();
    if (open === undefined) return;
    this.#options.monitoring.inputClosed();
    open.stopWatching();
    open.opened.close();
    this.#update({ opened: undefined, bufferedSeconds: 0, buffer: undefined });
  }

  /** The input or what carries it was lost: the session hears it, and the person is told why. */
  #lost(event: SessionEvent, problem: string): void {
    const { session } = this.#view.get();
    const moved =
      event.kind === 'failed' && (session.kind === 'armed' || session.kind === 'counting-in')
        ? this.#dispatch({ kind: 'disarm' })
        : this.#dispatch(event);
    if (!moved.ok) this.#close();
    // A take the input was lost under ends where it reached, so its channel
    // closes and storage keeps every frame that came.
    else if (session.kind === 'recording') this.takes.stopNow();
    this.#tell(problem);
  }

  /** Says why the input closed or would not open, where the views show it too. */
  #tell(problem: string): void {
    this.#update({ problem });
    this.#options.announce(problem);
  }

  readonly #permissionChanged = (permission: MicrophonePermission): void => {
    this.#update({ permission });
    this.#follow(permissionFollowing(this.#view.get().session, permission, this.#setup()));
  };

  readonly #devicesChanged = (devices: InputView['devices']): void => {
    this.#update({ devices, listing: { kind: 'listed' } });
    const { session, opened } = this.#view.get();
    this.#follow(devicesFollowing(session, opened?.device, devices, this.#setup()));
  };

  /** Takes the session along with what the browser reported, as `following` says. */
  #follow(following: Following): void {
    if (following?.kind === 'event') this.#dispatch(following.event);
    else if (following?.kind === 'lost') this.#lost(following.event, following.problem);
  }

  /** Stops a recording or a count-in the browser may have suspended, saying why. */
  #suspended(why: string): void {
    const { session } = this.#view.get();
    if (session.kind !== 'recording' && session.kind !== 'counting-in') return;
    this.takes.stop(this.contextFrame() ?? derivedSampleCount(0), 'background-suspended');
    this.#tell(why);
  }

  readonly #settingsChanged = (): void => {
    const followed = followedOf(this.#options.settings.get().recording);
    const events = followingEvents(this.#followed, followed);
    this.#followed = followed;
    const { session } = this.#view.get();
    if (session.kind !== 'ready' && session.kind !== 'armed') return;
    for (const event of events) this.#dispatch(event);
    if (events.some((event) => event.kind === 'retrospective-set')) this.#armCapture();
  };

  #update(change: Partial<InputView>): void {
    this.#view.set({ ...this.#view.get(), ...change });
  }
}
