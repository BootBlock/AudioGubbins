/**
 * A run of the game preview, as the transport plays it (ADR-0104): the
 * simulation of a scenario played as its plan through the one playback control,
 * a short way ahead of what the feeder reads, and continued without a break as
 * playback goes on, as a hand triggers or stops an emitter, and as the person
 * moves what can be heard moving.
 *
 * The run keeps one lineage: the hand actions so far, the simulation made of
 * them and the plan made of that, and the programme playing it. Every change
 * goes on from it in turn, one at a time: the simulation is continued from its
 * own state and the plan extended from the frame the change starts at, which
 * costs the change's own events, and the transport goes on into the new
 * programme from there (`PlaybackControl.continue`). A continuation the feeder
 * has read past is made again from where it had read; a hand action is moved to
 * that frame. The plan is laid {@link AHEAD_SECONDS} ahead of what the feeder
 * reads, so a hand trigger replaces little, and it is laid afresh at a silent
 * moment once it holds many voices (`preview-rebase.ts`), so a long run's plan
 * does not grow without end.
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
import { FROM_THE_START, quietAt, rebasedView, voicesLaid, type Rebase } from './preview-rebase.js';
import type { PreviewSetup } from './preview-setup.js';
import type { Programme } from './programme.js';

/** How far ahead of what the feeder reads the plan is laid, in seconds. */
export const AHEAD_SECONDS = 1;

/** How often the run looks at where playback is, to lay more and list what was heard. */
const LOOK_EVERY_MILLISECONDS = 100;

/** How many voices a plan holds before it is laid afresh at the next silent moment. */
export const REBASE_AFTER_VOICES = 256;

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
  readonly hand: readonly HandAction[];
  readonly simulation: PreviewSimulation;
  readonly plan: PreviewPlan;
  readonly rebase: Rebase;
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
    const plan = laidAfresh(setup, simulation.value, FROM_THE_START);
    if (!plan.ok) return plan;
    const run = new PreviewRun(setup, key, ports, {
      hand: [],
      simulation: simulation.value,
      plan: plan.value,
      rebase: FROM_THE_START,
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
   * from `from`, laid afresh where it holds many voices and nothing sounds at
   * `read`, the first frame the feeder may switch at.
   */
  #built(
    base: Lineage,
    hand: readonly HandAction[],
    horizon: number,
    from: number,
    read: number,
  ): DomainResult<Lineage> {
    const simulated = simulatePreview(inputOf(this.#setup, hand, horizon), base.simulation);
    if (!simulated.ok) return simulated;
    const simulation = simulated.value;
    const quiet =
      voicesLaid(simulation, base.rebase) > REBASE_AFTER_VOICES
        ? quietAt(simulation, base.rebase, read, this.#setup.rate)
        : undefined;
    const rebase = quiet ?? base.rebase;
    const plan =
      quiet === undefined
        ? extendPreviewPlan(base.plan, rebasedView(simulation, rebase), from)
        : laidAfresh(this.#setup, simulation, rebase);
    return mapResult(plan, (laid) => ({ hand, simulation, plan: laid, rebase }));
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
      const last = base.hand.at(-1)?.frame ?? 0;
      const build = (at: number): DomainResult<Lineage> =>
        this.#built(
          base,
          [...base.hand, { kind, emitter, frame: at }],
          Math.max(horizon, at + this.#ahead),
          Math.min(at, horizon),
          at,
        );
      const at = Math.max(this.#ports.playback.readFrame() ?? 0, last);
      const made = await this.#continue(build(at), at, build);
      const frame = made?.hand.at(-1)?.frame;
      if (kind === 'trigger' && frame !== undefined) this.#progress.pressed(frame, pressed);
    });
  }

  #extend(): Promise<void> {
    this.#extending = true;
    return this.#enqueue(async () => {
      const base = this.#lineage;
      const read = this.#ports.playback.readFrame() ?? 0;
      const from = base.simulation.log.horizonFrame;
      const build = (at: number): DomainResult<Lineage> =>
        this.#built(base, base.hand, Math.max(from, at) + this.#ahead, from, at);
      await this.#continue(build(read), from, build);
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
      if (!this.#extending && horizon - read < this.#ahead / 2) {
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

/**
 * `simulation`'s plan laid from `rebase`, its identifiers drawn from the
 * scenario's seed, so a run laid afresh keeps every panner and gain's.
 */
function laidAfresh(
  setup: PreviewSetup,
  simulation: PreviewSimulation,
  rebase: Rebase,
): DomainResult<PreviewPlan> {
  return previewPlan(
    rebasedView(simulation, rebase),
    setup.scenario,
    setup.members,
    setup.catalogue,
    createDeterministicIdGenerator(setup.scenario.seed),
    setup.layout,
  );
}
