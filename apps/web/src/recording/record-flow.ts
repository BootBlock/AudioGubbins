/**
 * Recording into a project (`ADR-0070`, `ADR-0071`, `ADR-0072`, `REQ-REC-020`):
 * Record and Stop, a punch's pre-roll and post-roll on the one media clock, a
 * controlled recording's count-in, timed stop and set start, and each take
 * carried from the capture to the storage worker and back to what it became.
 *
 * The input control holds the session's state and the input; this decides where
 * a take goes and when it begins and ends, and hands each take to the storage
 * worker (`take-recording.ts`). Whatever ends a take, the person, its timed
 * end, the page hidden, the device or the permission lost, storage full or
 * capture failing, the session says why as it stops, and the take is stopped
 * with that ending, once. A take that finishes leaves the input armed for the
 * stack it went into, so successive takes go into the stack that is armed
 * (`REQ-REC-089`).
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import { FromCaptureKind } from '@audiogubbins/audio-runtime';
import type { RecordingSessionId } from '@audiogubbins/project-format';
import type { RecordingStatus } from '@audiogubbins/storage-runtime';

import type { PlaybackControl } from '../audio/playback-control.js';
import type { AudioSettingsStore } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import { observable, type Observable } from '../state/observable.js';
import { compensationNow } from './calibration-path.js';
import { ControlledRun, scheduleOf, type RecordingPlan } from './controlled-run.js';
import type { InputControl } from './input-control.js';
import type { PageWatch } from './open-input-watch.js';
import { startPunch } from './punch-start.js';
import { recordingStartOf } from './recording-start.js';
import { saidOfOutcome } from './take-outcome.js';
import { TakeRecording, type RecordingWhere, type TakeOutcome } from './take-recording.js';
import { IDLE, type TakeProgress } from './take-progress.js';
import { takeSetUp } from './take-set-up.js';
import { takeTargetOf, type PunchPlace, type TakeTarget } from './take-target.js';
import { endingOf, timeLeftWarning } from './take-words.js';

/** What the flow is made with. */
export interface RecordFlowOptions {
  readonly input: InputControl;
  readonly playback: PlaybackControl;
  readonly audio: Observable<AudioView>;
  readonly settings: AudioSettingsStore;
  readonly page: PageWatch;
  readonly suspensionRisk: boolean;
  readonly schedule: (callback: () => void, milliseconds: number) => () => void;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  /** A new recording session's identifier, which the page mints. */
  readonly mint: () => RecordingSessionId;
  readonly announce: (text: string) => void;
  readonly logger: Logger;
}

/** The take being made. */
interface Running {
  readonly take: TakeRecording;
  readonly name: string;
  readonly rate: number;
  readonly punch: boolean;
  readonly stopHearing: () => void;
  stopped: boolean;
  warned: boolean;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`recording.${code}`, FailureKind.Rejected, summary));
}

/** Records takes into a project (see the module comment). */
export class RecordFlow {
  readonly #options: RecordFlowOptions;
  readonly #progress = observable<TakeProgress>(IDLE);
  #running: Running | undefined;
  #run: ControlledRun | undefined;
  #punching: AbortController | undefined;
  readonly #stopFollowing: () => void;

  constructor(options: RecordFlowOptions) {
    this.#options = options;
    this.#stopFollowing = options.input.view.subscribe(this.#sessionChanged);
  }

  /** How far the take being made has come. */
  get progress(): Observable<TakeProgress> {
    return this.#progress;
  }

  /** Why Record cannot be pressed now, or nothing where it can. */
  recordRefusal(): string | undefined {
    if (this.#busy()) return 'A take is being made already.';
    const { session, opened } = this.#options.input.view.get();
    if (session.kind !== 'armed') return 'Arm the input first.';
    return opened === undefined ? 'The input is still opening.' : undefined;
  }

  /**
   * Records a take where the armed input's purpose says, into `where`: a punch
   * with its pre-roll and post-roll, a controlled recording as `plan` sets it,
   * or at once. Answers why not where it cannot begin.
   */
  record(where: RecordingWhere, plan: RecordingPlan): DomainResult<void> {
    const refusal = this.recordRefusal();
    if (refusal !== undefined) return refused('not-ready', refusal);
    const { input } = this.#options;
    const { session, opened } = input.view.get();
    if (session.kind !== 'armed' || opened === undefined)
      return refused('not-ready', 'Arm the input first.');
    const target = takeTargetOf(
      session.purpose,
      where.project.getSnapshot().model.state.project,
      opened.rate,
    );
    if (!target.ok) return target;
    const place = placeOf(target.value);
    if (place !== undefined) return this.#punch(where, target.value, place);
    const controlled =
      plan.countInSeconds > 0 || plan.stopAfterSeconds !== undefined || plan.startAt !== undefined;
    const now = input.contextFrame();
    if (now === undefined) return refused('not-ready', 'The input is still opening.');
    if (!controlled) return this.#start(where, target.value, { recordAt: now, countIn: false });
    return this.#controlled(where, target.value, plan, now, opened.rate);
  }

  /** Stops the take being made, a punch's pre-roll, or a recording still waiting to begin. */
  stop(): DomainResult<void> {
    const { input, playback } = this.#options;
    if (this.#punching !== undefined) {
      this.#punching.abort();
      playback.stop();
      return succeed(undefined);
    }
    const { session } = input.view.get();
    if (session.kind === 'recording' || session.kind === 'counting-in') {
      return input.takes.stop(input.contextFrame() ?? derivedSampleCount(0), 'person');
    }
    if (this.#run !== undefined) {
      this.#endRun();
      this.#progress.set(IDLE);
      this.#options.announce('The scheduled recording was cancelled.');
      return succeed(undefined);
    }
    return refused('not-recording', 'Nothing is being recorded.');
  }

  /** Lets go of everything the flow follows, for good. */
  dispose(): void {
    this.#stopFollowing();
    this.#punching?.abort();
    this.#endRun();
  }

  #busy(): boolean {
    return this.#running !== undefined || this.#run !== undefined || this.#punching !== undefined;
  }

  /** Schedules a controlled recording, saying first where the browser may suspend it. */
  #controlled(
    where: RecordingWhere,
    target: TakeTarget,
    plan: RecordingPlan,
    now: SampleCount,
    rate: SampleRate,
  ): DomainResult<void> {
    const { input, page, suspensionRisk, schedule, now: clock } = this.#options;
    const scheduled = scheduleOf(plan, {
      now,
      rate,
      epochNow: clock(),
      pageVisible: page.visibility() !== 'hidden',
      suspensionRisk,
    });
    if (!scheduled.ok) return scheduled;
    const { caution, stopAt } = scheduled.value;
    if (caution !== undefined) this.#options.announce(caution);
    this.#progress.set({ kind: 'scheduled', caution });
    const begin = (recordAt: SampleCount, countIn: boolean): void => {
      const begun = this.#start(where, target, {
        recordAt,
        countIn,
        ...(stopAt === undefined ? {} : { stopAt }),
      });
      if (!begun.ok) {
        this.#endRun();
        this.#progress.set(IDLE);
        this.#options.announce(begun.failures[0].summary);
      }
    };
    this.#run = new ControlledRun(
      scheduled.value,
      {
        frame: () => input.contextFrame(),
        rate,
        schedule,
        visible: () => page.visibility() !== 'hidden',
        watch: page.watch,
      },
      {
        countIn: (recordAt) => {
          begin(recordAt, true);
        },
        record: (recordAt) => {
          begin(recordAt, false);
        },
        suspended: this.#runSuspended,
        cancelled: this.#runCancelled,
      },
    );
    return succeed(undefined);
  }

  /** The page was hidden while a controlled recording ran: it stops, keeping what it has. */
  readonly #runSuspended = (): void => {
    const { input } = this.#options;
    this.#run = undefined;
    input.takes.stop(input.contextFrame() ?? derivedSampleCount(0), 'background-suspended');
    this.#options.announce(
      'The page went into the background, where the browser may pause capture, so the recording stopped and keeps what it has.',
    );
  };

  /** A controlled recording was given up before its take began, for `reason`. */
  readonly #runCancelled = (reason: string): void => {
    const { input } = this.#options;
    this.#run = undefined;
    if (input.view.get().session.kind === 'counting-in') {
      input.takes.stop(input.contextFrame() ?? derivedSampleCount(0), 'background-suspended');
    }
    this.#progress.set(IDLE);
    this.#options.announce(reason);
  };

  /**
   * Plays a punch's audio from before its pre-roll, then records from the
   * pre-roll to the end of the post-roll, stopping by itself there.
   */
  #punch(where: RecordingWhere, target: TakeTarget, place: PunchPlace): DomainResult<void> {
    const programme = where.programme(place.asset.id);
    if (typeof programme === 'string') return refused('punch-unplayable', programme);
    const { opened } = this.#options.input.view.get();
    if (opened === undefined) return refused('not-ready', 'The input is still opening.');
    const punching = new AbortController();
    this.#punching = punching;
    this.#progress.set({ kind: 'pre-roll', take: target.takeName });
    void startPunch(
      this.#options.playback,
      this.#options.audio,
      programme,
      place,
      opened.rate,
      punching.signal,
    ).then((frames) => {
      if (this.#punching !== punching) return;
      this.#punching = undefined;
      if (!frames.ok) {
        this.#progress.set(IDLE);
        if (!punching.signal.aborted) this.#options.announce(frames.failures[0].summary);
        return;
      }
      const begun = this.#start(where, target, { ...frames.value, countIn: false }, true);
      if (!begun.ok) {
        this.#options.playback.stop();
        this.#progress.set(IDLE);
        this.#options.announce(begun.failures[0].summary);
      }
    });
    return succeed(undefined);
  }

  /**
   * Begins a take for `target` on context frame `recordAt`, counted in to it or
   * not, stopping before `stopAt` where one is given, and hands it to the
   * storage worker once the capture says which frame it begins on.
   */
  #start(
    where: RecordingWhere,
    target: TakeTarget,
    at: {
      readonly recordAt: SampleCount;
      readonly countIn: boolean;
      readonly stopAt?: SampleCount;
    },
    punch = false,
  ): DomainResult<void> {
    const { input, playback, settings, schedule, logger } = this.#options;
    const view = input.view.get();
    const facts = view.opened;
    if (facts === undefined) return refused('not-ready', 'The input closed before the take began.');
    const start = recordingStartOf(facts, this.#options.now());
    if (!start.ok) return start;
    const latency = compensationNow(view, settings.get().recording)?.frames ?? 0;
    const port = this.#asked(at);
    if (!port.ok) return port;
    const take = new TakeRecording({
      client: where.client,
      project: where.project,
      session: this.#options.mint(),
      port: port.value,
      schedule,
      logger,
      status: (status) => {
        this.#status(status);
      },
    });
    // The take is begun in the worker once the capture says which frame is
    // its first, which a retrospective buffer puts before Record.
    const stopHearing = input.subscribeCapture((event) => {
      if (event.kind !== FromCaptureKind.Recording) return;
      const transportFrame = playback.transportAt(event.firstFrame, facts.rate) ?? 0;
      take.begin(takeSetUp(target, start.value, { transportFrame, latency }));
      this.#begun(take);
    });
    this.#running = {
      take,
      name: target.takeName,
      rate: facts.rate,
      punch,
      stopHearing,
      stopped: false,
      warned: false,
    };
    void take.outcome.then((outcome) => {
      this.#settled(where, take, outcome);
    });
    return succeed(undefined);
  }

  /** Asks the capture for a take as `at` says, with its timed stop where it has one. */
  #asked(at: {
    readonly recordAt: SampleCount;
    readonly countIn: boolean;
    readonly stopAt?: SampleCount;
  }): DomainResult<MessagePort> {
    const { takes } = this.#options.input;
    const port = at.countIn ? takes.countIn(at.recordAt, true) : takes.record(at.recordAt, true);
    if (port.ok && at.stopAt !== undefined) {
      const told = takes.stopBefore(at.stopAt);
      if (!told.ok) {
        this.#options.logger.warning('The timed stop could not be set.', {
          reason: told.failures[0].summary,
        });
      }
    }
    return port;
  }

  /** The capture began `take`: a controlled recording runs, and the take's progress shows. */
  #begun(take: TakeRecording): void {
    this.#run?.recording();
    const running = this.#running;
    if (running?.take !== take) return;
    this.#progress.set({
      kind: 'recording',
      take: running.name,
      committed: 0,
      lost: { count: 0, frames: 0 },
      timeLeft: undefined,
      rate: running.rate,
    });
  }

  /** Follows the session: a take is stopped, with the session's reason, as the session stops. */
  readonly #sessionChanged = (): void => {
    const running = this.#running;
    if (running === undefined || running.stopped) return;
    const { session } = this.#options.input.view.get();
    if (session.kind === 'stopping') {
      running.stopped = true;
      this.#endRun();
      this.#progress.set({ kind: 'finishing', take: running.name });
      running.take.stop(endingOf(session.reason));
    } else if (session.kind !== 'recording' && session.kind !== 'counting-in') {
      // A count-in stopped, or an input lost before its take began: nothing
      // was recorded, and the capture channel is let go of.
      running.stopped = true;
      this.#endRun();
      running.take.stop(endingOf({ kind: 'person' }));
    }
  };

  /** What the worker says of the take as it is committed. */
  #status(status: RecordingStatus): void {
    const running = this.#running;
    if (running === undefined) return;
    if (status.kind === 'recording') {
      if (!running.stopped) {
        this.#progress.set({
          kind: 'recording',
          take: running.name,
          committed: status.committed,
          lost: status.lost,
          timeLeft: status.timeLeft,
          rate: running.rate,
        });
      }
      const warning = timeLeftWarning(status.timeLeft);
      if (warning !== undefined && !running.warned) {
        running.warned = true;
        this.#options.announce(`${warning} Stop at a phrase's end before it runs out.`);
      }
    } else if (status.kind === 'ended' && !status.named && !running.stopped) {
      this.#storageEnded(status);
    }
  }

  /** Storage ended the take itself, full or failing: the session stops with it. */
  #storageEnded(status: Extract<RecordingStatus, { kind: 'ended' }>): void {
    const { input } = this.#options;
    if (input.view.get().session.kind !== 'recording') return;
    if (status.ending === 'storage-full') {
      input.takes.stop(input.contextFrame() ?? derivedSampleCount(0), 'quota');
      return;
    }
    input.takes.abandon(
      failure(
        'recording.storage-ended',
        FailureKind.Rejected,
        status.problem ?? 'Storage could not keep the recording, so it stopped.',
      ),
    );
  }

  /** The take came to `outcome`: the session finishes, and the person is told what it came to. */
  #settled(where: RecordingWhere, take: TakeRecording, outcome: TakeOutcome): void {
    const running = this.#running;
    if (running?.take !== take) return;
    this.#running = undefined;
    running.stopHearing();
    this.#endRun();
    this.#progress.set(IDLE);
    const { input, playback, announce } = this.#options;
    const { session } = input.view.get();
    // A take the worker would not begin, or could not keep, while the
    // capture still runs is stopped, so the input stays armed.
    if (session.kind === 'recording' || session.kind === 'counting-in') {
      running.stopped = true;
      input.takes.stop(input.contextFrame() ?? derivedSampleCount(0), 'person');
    }
    if (input.view.get().session.kind === 'stopping') input.stopped();
    if (running.punch) playback.stop();
    const said = saidOfOutcome(outcome);
    if (said !== undefined) announce(said);
    if (outcome.kind === 'kept') where.kept();
    if (outcome.kind === 'finished' && input.view.get().session.kind === 'armed') {
      input.retarget({ kind: 'take', stack: outcome.recording.stack });
    }
  }

  #endRun(): void {
    this.#run?.end();
    this.#run = undefined;
  }
}

/** The punch a target records over, where it is a punch's. */
function placeOf(target: TakeTarget): PunchPlace | undefined {
  return target.kind === 'punch' ? target.place : target.kind === 'take' ? target.punch : undefined;
}
