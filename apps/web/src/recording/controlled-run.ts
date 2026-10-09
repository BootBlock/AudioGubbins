/**
 * A controlled recording kept to its schedule (`ADR-0070`, `REQ-REC-020`,
 * `REQ-REC-097`): the timer that asks the schedule what to do at the media
 * clock's frame now, and the page's visibility it watches while the recording
 * waits, counts in and runs.
 *
 * The schedule decides (`scheduleStep`); this only keeps time. It acts a short
 * lead before each frame the schedule names, giving the frame itself, so the
 * capture, which waits on the audio thread, begins on it exactly whatever the
 * timer's own lateness. The timer and the clock are given, so a test steps
 * both.
 */

import {
  derivedSampleCount,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import type { PageVisibility } from '@audiogubbins/capabilities';
import {
  scheduleRecording,
  scheduleStep,
  type ControlledRecording,
  type RecordingSchedule,
  type SchedulePhase,
} from '@audiogubbins/recording';

/** A controlled recording as the person sets it, in seconds and the time of day. */
export interface RecordingPlan {
  /** Seconds counted in before the take begins. */
  readonly countInSeconds: number;
  /** Seconds after which the take stops by itself, where it does. */
  readonly stopAfterSeconds?: number;
  /** When the take begins, in milliseconds since the epoch, where it is set. */
  readonly startAt?: number;
}

/** What is true as a controlled recording is scheduled. */
export interface PlanFacts {
  /** The media clock's frame now, and its rate. */
  readonly now: SampleCount;
  readonly rate: SampleRate;
  /** Milliseconds since the epoch now, which a set start is given in. */
  readonly epochNow: number;
  readonly pageVisible: boolean;
  readonly suspensionRisk: boolean;
}

/**
 * The schedule of `plan`, its seconds and its time of day put in frames of the
 * media clock, or why it cannot be kept (`scheduleRecording`).
 */
export function scheduleOf(plan: RecordingPlan, facts: PlanFacts): DomainResult<RecordingSchedule> {
  const { now, rate } = facts;
  const frames = (seconds: number): SampleCount => derivedSampleCount(Math.round(seconds * rate));
  const controlled: ControlledRecording = {
    countIn: frames(plan.countInSeconds),
    ...(plan.stopAfterSeconds === undefined ? {} : { stopAfter: frames(plan.stopAfterSeconds) }),
    ...(plan.startAt === undefined
      ? {}
      : { startAt: derivedSampleCount(now + frames((plan.startAt - facts.epochNow) / 1_000)) }),
  };
  return scheduleRecording(controlled, {
    now,
    armed: true,
    pageVisible: facts.pageVisible,
    suspensionRisk: facts.suspensionRisk,
  });
}

/** How early a step is acted on, so the frame it names is still to come on the audio thread. */
const STEP_LEAD_SECONDS = 0.2;

/** What a schedule's steps do, each given the frame it is for. */
export interface ControlledActions {
  /** The count-in begins now, to end, and the take begin, on `recordAt`. */
  readonly countIn: (recordAt: SampleCount) => void;
  /** The take begins on `recordAt`, with no count-in. */
  readonly record: (recordAt: SampleCount) => void;
  /** The page was hidden while recording, where a browser may suspend capture. */
  readonly suspended: () => void;
  /** The schedule was given up before the take began, for `reason`. */
  readonly cancelled: (reason: string) => void;
}

/** What keeps a schedule's time. */
export interface ControlledClock {
  /** The media clock's frame now, or `undefined` once there is no context to read. */
  readonly frame: () => SampleCount | undefined;
  readonly rate: SampleRate;
  /** Calls `callback` after `milliseconds`, answering how to cancel it. */
  readonly schedule: (callback: () => void, milliseconds: number) => () => void;
  readonly visible: () => boolean;
  readonly watch: (changed: (visibility: PageVisibility) => void) => () => void;
}

/** One controlled recording, from its scheduling until it has begun and ended, or been given up. */
export class ControlledRun {
  readonly #schedule: RecordingSchedule;
  readonly #clock: ControlledClock;
  readonly #actions: ControlledActions;
  #phase: SchedulePhase = 'waiting';
  #cancelTimer: () => void = () => undefined;
  readonly #stopWatching: () => void;
  #over = false;

  constructor(schedule: RecordingSchedule, clock: ControlledClock, actions: ControlledActions) {
    this.#schedule = schedule;
    this.#clock = clock;
    this.#actions = actions;
    this.#stopWatching = clock.watch(() => {
      this.#step();
    });
    this.#step();
  }

  /** The take began: from now on only the page's visibility can end it early. */
  recording(): void {
    this.#phase = 'recording';
  }

  /** Lets go of the timer and the page, for good: the take ended, or was stopped. */
  end(): void {
    this.#over = true;
    this.#cancelTimer();
    this.#stopWatching();
  }

  #step(): void {
    if (this.#over) return;
    this.#cancelTimer();
    const now = this.#clock.frame();
    if (now === undefined) {
      this.#give(() => {
        this.#actions.cancelled('The scheduled recording was cancelled because the input closed.');
      });
      return;
    }
    const lead = Math.round(STEP_LEAD_SECONDS * this.#clock.rate);
    const ahead = derivedSampleCount(now + lead);
    const step = scheduleStep(this.#schedule, this.#phase, ahead, this.#clock.visible());
    switch (step.kind) {
      case 'wait':
        if (step.until !== undefined) {
          const milliseconds = ((step.until - ahead) / this.#clock.rate) * 1_000;
          this.#cancelTimer = this.#clock.schedule(
            () => {
              this.#step();
            },
            Math.max(0, milliseconds),
          );
        }
        return;
      case 'begin-count-in':
        this.#phase = 'counting-in';
        this.#actions.countIn(this.#schedule.recordAt);
        return;
      case 'begin-recording': {
        // A count-in's take begins by itself on its frame, as the capture
        // was told when the count-in began, so only a take with none is
        // begun here.
        const counted = this.#phase === 'counting-in';
        this.#phase = 'recording';
        if (!counted) this.#actions.record(this.#schedule.recordAt);
        return;
      }
      case 'stop':
        // A timed stop is the capture's own, told when the take was asked
        // for; only the page's suspension is acted on here.
        if (step.reason === 'background-suspended') {
          this.#give(() => {
            this.#actions.suspended();
          });
        }
        return;
      case 'cancel':
        this.#give(() => {
          this.#actions.cancelled(step.reason);
        });
        return;
    }
  }

  /** Ends the run, then does `last`. */
  #give(last: () => void): void {
    this.end();
    last();
  }
}
