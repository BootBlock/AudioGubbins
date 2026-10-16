/**
 * A run of the game preview, as the transport plays it (ADR-0104): the
 * simulation of a scenario played as its plan through the one playback control,
 * a short way ahead of what the feeder reads, and continued without a break as
 * playback goes on, as a hand triggers or stops an emitter, and as the person
 * moves what can be heard moving.
 *
 * The run keeps one lineage: the simulation, which holds the hand actions it
 * was given, the plan made of it, and the programme playing it. Every change
 * goes on from it in turn, one at a time: the simulation is continued from its
 * own state and the plan extended from the frame the change starts at, which
 * costs the change's own events, and the transport goes on into the new
 * programme from there (`PlaybackControl.continue`). A continuation the feeder
 * has read past is made again from where it had read; a hand action is moved to
 * that frame. The plan is laid {@link AHEAD_SECONDS} ahead of what the feeder
 * reads, so a hand trigger replaces little. As playback goes on, the run
 * forgets, every {@link FORGET_EVERY_SECONDS}, what was heard more than
 * {@link FORGET_BEHIND_SECONDS} before the listener (`forgetPreviewBefore`,
 * `forgetPreviewPlanBefore`), so a run that plays for long, a loop never
 * stopped among it, holds a simulation and a plan as large as what is still to
 * be heard, and the feeder keeps every reader of what sounds.
 *
 * The run plays at the person's preview quality, as the transport plays
 * everything, and reads the project only through the setup it was made with; it
 * runs no project command and changes no edit.
 */

import {
  createDeterministicIdGenerator,
  derivedSampleCount,
  mapResult,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  extendPreviewPlan,
  forgetPreviewBefore,
  forgetPreviewPlanBefore,
  previewPlan,
  simulatePreview,
  type GamePreviewScenario,
  type HandAction,
  type PreviewEmitterId,
  type PreviewInput,
  type PreviewPlan,
  type PreviewSimulation,
} from '@audiogubbins/game-audio';

import type { PreviewRunStats, PreviewRunView } from '../state/game-preview-store.js';
import { reasonsOf, type Reasons } from '../state/reasons.js';
import type { PlaybackControl } from './playback-control.js';
import { liveValues, withLiveValues, type LiveValues } from './preview-live-values.js';
import { LogProgress } from './preview-log-progress.js';
import { previewProgramme } from './preview-programme.js';
import type { PreviewSetup } from './preview-setup.js';
import type { Programme } from './programme.js';

/** How far ahead of what the feeder reads the plan is laid, in seconds. */
export const AHEAD_SECONDS = 1;

/** How often the run looks at where playback is, to lay more and list what was heard. */
const LOOK_EVERY_MILLISECONDS = 100;

/** How far behind what the listener hears the run forgets, in seconds. */
const FORGET_BEHIND_SECONDS = 1;

/** How often, in seconds of playback, the run forgets what was heard. */
export const FORGET_EVERY_SECONDS = 5;

/** The part of the playback control a run drives. */
export type PreviewPlayback = Pick<
  PlaybackControl,
  'play' | 'continue' | 'readFrame' | 'audiblePosition' | 'follow' | 'stop' | 'programme'
>;

/** What a run plays through and tells. */
export interface RunPorts {
  readonly playback: PreviewPlayback;
  /** Runs a callback after a delay, answering how to call it off. */
  readonly schedule: (callback: () => void, milliseconds: number) => () => void;
  /** The time in milliseconds, for how late a hand trigger is heard. */
  readonly now: () => number;
  readonly show: (run: PreviewRunView) => void;
}

/** What a run has made and plays. */
interface Lineage {
  readonly simulation: PreviewSimulation;
  readonly plan: PreviewPlan;
}

/** A run of a scenario's preview: playing, continued, and stopped. */
export class PreviewRun {
  readonly #setup: PreviewSetup;
  readonly #key: string;
  readonly #ports: RunPorts;
  /** The frames the plan is laid ahead of what the feeder reads. */
  readonly #ahead: number;
  readonly #progress: LogProgress;
  #lineage: Lineage;
  #live: LiveValues = new Map();
  #version = 0;
  /** The changes made so far, each going on from the one before. */
  #work: Promise<void> = Promise.resolve();
  #extending = false;
  /** The frame before which the run has forgotten what was heard. */
  #forgotten = 0;
  /** Whether the transport has taken the programme, which it may later give up. */
  #heard = false;
  #ended = false;
  #cancelLook: () => void = () => undefined;
  #ready: () => void = () => undefined;
  readonly #loaded: Promise<void>;

  private constructor(setup: PreviewSetup, key: string, ports: RunPorts, lineage: Lineage) {
    this.#setup = setup;
    this.#key = key;
    this.#ports = ports;
    this.#ahead = Math.round(AHEAD_SECONDS * setup.rate);
    this.#progress = new LogProgress(setup);
    this.#lineage = lineage;
    this.#loaded = new Promise((resolve) => {
      this.#ready = resolve;
    });
  }

  /** Plays `setup` from its start under `key`, or says why it cannot be played. */
  static start(setup: PreviewSetup, key: string, ports: RunPorts): DomainResult<PreviewRun> {
    const horizon = Math.round(AHEAD_SECONDS * setup.rate);
    const simulation = simulatePreview(inputOf(setup, [], horizon));
    if (!simulation.ok) return simulation;
    const plan = laidAfresh(setup, simulation.value);
    if (!plan.ok) return plan;
    const run = new PreviewRun(setup, key, ports, {
      simulation: simulation.value,
      plan: plan.value,
    });
    ports.playback.play(run.#programmeOf(run.#lineage), derivedSampleCount(0));
    run.#look();
    run.#show();
    return succeed(run);
  }

  /** The key of the programme this run plays. */
  get key(): string {
    return this.#key;
  }

  /** The scenario it plays. */
  get scenario(): GamePreviewScenario['id'] {
    return this.#setup.scenario.id;
  }

  /** Its emitters, in the scenario's order. */
  get emitters(): readonly PreviewEmitterId[] {
    return this.#setup.scenario.emitters.map((emitter) => emitter.id);
  }

  /** Whether it has stopped, by request or by itself. */
  get ended(): boolean {
    return this.#ended;
  }

  /** Triggers `emitter` by hand, as soon as playback can hear it. */
  trigger(emitter: PreviewEmitterId): Promise<void> {
    return this.#act('trigger', emitter);
  }

  /** Stops every voice of `emitter`, each fading out. */
  stopVoices(emitter: PreviewEmitterId): Promise<void> {
    return this.#act('stop', emitter);
  }

  /**
   * Plays the values `now`, the scenario as it is set up now, gives each still
   * emitter, the listener and each bus, as a running change.
   */
  follow(now: GamePreviewScenario): Promise<void> {
    return this.#enqueue(() => {
      const values = liveValues(this.#setup, this.#lineage.plan.controls, now);
      if (values === undefined) return Promise.resolve();
      this.#live = values;
      this.#ports.playback.follow(this.#programmeOf(this.#lineage));
      return Promise.resolve();
    });
  }

  /** Stops the run and what it plays. */
  stop(): void {
    if (this.#ended) return;
    this.#end();
    if (this.#ports.playback.programme() === this.#key) this.#ports.playback.stop();
    this.#ports.show({ kind: 'stopped', stats: this.#stats() });
  }

  #end(): void {
    this.#ended = true;
    this.#cancelLook();
    this.#ready();
  }

  #endFor(reasons: Reasons): void {
    if (this.#ended) return;
    this.#end();
    this.#ports.show({ kind: 'ended', reasons, stats: this.#stats() });
  }

  #programmeOf(built: Lineage, from?: number): Programme {
    this.#version += 1;
    return previewProgramme(
      this.#setup,
      this.#key,
      this.#version,
      withLiveValues(built.plan.plan, this.#live),
      from === undefined ? undefined : derivedSampleCount(from),
    );
  }

  /**
   * Runs `change` once every change before it has settled. A change that faults
   * ends the run, saying why, rather than leaving every later change waiting on
   * it.
   */
  #enqueue(change: () => Promise<void>): Promise<void> {
    const next = this.#work
      .then(() => (this.#ended ? undefined : change()))
      .then(undefined, (error: unknown) => {
        this.#endFor([`The preview stopped on a fault: ${messageOf(error)}`]);
      });
    this.#work = next;
    return next;
  }

  /**
   * The lineage going on from `base` with `hand` to `horizon`, its plan changed
   * from `from`, and everything before `forget` forgotten where it is given.
   */
  #built(
    base: Lineage,
    hand: readonly HandAction[],
    horizon: number,
    from: number,
    forget?: number,
  ): DomainResult<Lineage> {
    const simulated = simulatePreview(inputOf(this.#setup, hand, horizon), base.simulation);
    if (!simulated.ok) return simulated;
    const simulation =
      forget === undefined ? simulated : forgetPreviewBefore(simulated.value, forget);
    if (!simulation.ok) return simulation;
    const extended = extendPreviewPlan(base.plan, simulation.value, from);
    const plan =
      forget === undefined || !extended.ok
        ? extended
        : forgetPreviewPlanBefore(extended.value, forget);
    return mapResult(plan, (laid) => ({ simulation: simulation.value, plan: laid }));
  }

  /**
   * The frame before which the run forgets what was heard, where it is time to
   * forget more: a whole number of {@link FORGET_EVERY_SECONDS} at least
   * {@link FORGET_BEHIND_SECONDS} behind what the listener hears now, which the
   * feeder has read past, so every event before it has been heard and listed.
   */
  #forgetting(): number | undefined {
    const heard = this.#ports.playback.audiblePosition();
    if (heard === undefined) return undefined;
    const { rate } = this.#setup;
    const every = FORGET_EVERY_SECONDS * rate;
    const frame = Math.floor((heard - FORGET_BEHIND_SECONDS * rate) / every) * every;
    return frame > this.#progress.heardThrough || frame <= this.#forgotten ? undefined : frame;
  }

  /**
   * Goes on into `built` from `from`, made again by `again` where the feeder
   * had read past it, and answers what it went on into, or `undefined` where it
   * could not, which ends the run.
   */
  async #continue(
    built: DomainResult<Lineage>,
    from: number,
    again: (from: number) => DomainResult<Lineage>,
  ): Promise<Lineage | undefined> {
    if (!built.ok) {
      this.#endFor(reasonsOf(built.failures));
      return undefined;
    }
    let made = built.value;
    const outcome = await this.#ports.playback.continue(this.#programmeOf(made, from), (later) => {
      const remade = again(later);
      if (remade.ok) made = remade.value;
      return this.#programmeOf(made, later);
    });
    if (outcome.kind === 'refused') {
      this.#endFor(outcome.reasons);
      return undefined;
    }
    this.#lineage = made;
    return made;
  }

  #act(kind: HandAction['kind'], emitter: PreviewEmitterId): Promise<void> {
    const pressed = this.#ports.now();
    return this.#enqueue(async () => {
      await this.#loaded;
      if (this.#ended) return;
      const base = this.#lineage;
      const horizon = base.simulation.log.horizonFrame;
      const { hand } = base.simulation.state;
      const last = hand.at(-1)?.frame ?? 0;
      const build = (at: number): DomainResult<Lineage> =>
        this.#built(
          base,
          [...hand, { kind, emitter, frame: at }],
          Math.max(horizon, at + this.#ahead),
          Math.min(at, horizon),
        );
      const at = Math.max(this.#ports.playback.readFrame() ?? 0, last);
      const made = await this.#continue(build(at), at, build);
      const frame = made?.simulation.state.hand.at(-1)?.frame;
      if (kind === 'trigger' && frame !== undefined) this.#progress.pressed(frame, pressed);
    });
  }

  #extend(): Promise<void> {
    this.#extending = true;
    return this.#enqueue(async () => {
      const base = this.#lineage;
      const read = this.#ports.playback.readFrame() ?? 0;
      const from = base.simulation.log.horizonFrame;
      const forget = this.#forgetting();
      const build = (at: number): DomainResult<Lineage> =>
        this.#built(
          base,
          base.simulation.state.hand,
          Math.max(from, at) + this.#ahead,
          from,
          forget,
        );
      const made = await this.#continue(build(read), from, build);
      if (made !== undefined && forget !== undefined) this.#forgotten = forget;
    }).finally(() => {
      this.#extending = false;
    });
  }

  /** Looks at where playback is: lays more ahead, and lists what has been heard. */
  #look(): void {
    if (this.#ended) return;
    const { playback } = this.#ports;
    const holds = playback.programme() === this.#key;
    if (this.#heard && !holds) {
      this.#endFor(['Playback moved to something else, so the preview stopped.']);
      return;
    }
    const read = holds ? playback.readFrame() : undefined;
    if (read !== undefined) {
      this.#heard = true;
      this.#ready();
      const horizon = this.#lineage.simulation.log.horizonFrame;
      // Laid further, and what was heard forgotten, as each falls due.
      if (
        !this.#extending &&
        (horizon - read < this.#ahead / 2 || this.#forgetting() !== undefined)
      ) {
        void this.#extend();
      }
      const heard = playback.audiblePosition();
      if (
        heard !== undefined &&
        this.#progress.hear(this.#lineage.simulation.log, heard, this.#ports.now())
      ) {
        this.#show();
      }
    }
    this.#cancelLook = this.#ports.schedule(() => {
      this.#look();
    }, LOOK_EVERY_MILLISECONDS);
  }

  #show(): void {
    this.#ports.show({ kind: 'running', stats: this.#stats() });
  }

  #stats(): PreviewRunStats {
    return this.#progress.stats(this.#lineage.plan.plan.streams.length);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What simulating `setup` with `hand` to `horizon` takes. */
function inputOf(setup: PreviewSetup, hand: readonly HandAction[], horizon: number): PreviewInput {
  return {
    scenario: setup.scenario,
    emitterRules: setup.subjects.emitterRules,
    poolOf: setup.subjects.poolOf,
    hand,
    sampleRate: setup.rate,
    voiceBudget: setup.budget,
    horizonFrame: horizon,
  };
}

/** `simulation`'s plan, its identifiers drawn from the scenario's seed. */
function laidAfresh(setup: PreviewSetup, simulation: PreviewSimulation): DomainResult<PreviewPlan> {
  return previewPlan(
    simulation,
    setup.scenario,
    setup.members,
    setup.catalogue,
    createDeterministicIdGenerator(setup.scenario.seed),
    setup.layout,
  );
}
