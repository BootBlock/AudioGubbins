/**
 * A game preview's simulation (ADR-0104): a scenario's triggers decided by the
 * authored rules over a horizon of frames, as the event log a plan is built
 * from and an engine's runtime is held to.
 *
 * It is pure: the same input gives the same log, and it reads no clock and
 * changes nothing it is given, the project least of all. Triggers are taken in
 * order of frame; at one frame, by the emitters' identifiers, an emitter's
 * repeat trigger before its hand actions, and hand actions in the order given.
 * The voices that ended by a trigger's frame end before it
 * (`simulation-steps.ts`).
 *
 * A simulation is a value it goes on from: given the simulation it last made,
 * it keeps every event before the first frame its input changes (the first new
 * hand action, or the old horizon) and decides only from there, so a hand
 * trigger costs its own events rather than a new run, and what was heard is
 * never changed. It goes on from the last of its snapshots before that frame,
 * one taken every 256 actions (`simulation-loop.ts`).
 *
 * A simulation that plays for long forgets what came before a frame
 * ({@link forgetPreviewBefore}): its log keeps the events from there, its state
 * the run at that frame and the snapshots and hand actions after it, so what it
 * holds is bounded by what is still to be heard, not by how long it has played.
 * It goes on from that frame or later only.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import type { EmitterRules } from '../policy/playback-rules.js';
import type { PreviewEvent, PreviewEventLog } from './preview-event-log.js';
import {
  previewScenarioProblems,
  type GamePreviewScenario,
  type PreviewSubject,
} from './preview-scenario.js';
import type { PoolMember } from './preview-subjects.js';
import { EmitterRun, SimulationRun, type Snapshot } from './simulation-run.js';
import { advance } from './simulation-loop.js';
import { endVoicesBy, fadeFrames, type StepContext } from './simulation-steps.js';
import { emitterPlays, type EmitterPlay, type HandAction } from './trigger-schedule.js';

export interface PreviewInput {
  readonly scenario: GamePreviewScenario;
  /** The rules each subject plays by: resolved, or the default (`preview-subjects.ts`). */
  readonly emitterRules: (subject: PreviewSubject) => EmitterRules;
  /** Each subject's pool, at least one member. */
  readonly poolOf: (subject: PreviewSubject) => readonly PoolMember[];
  /** In order of frame; a continuation's are its predecessor's and then its own. */
  readonly hand: readonly HandAction[];
  readonly sampleRate: SampleRate;
  /** The most voices sounding at once across every emitter (`voice-budget.ts`). */
  readonly voiceBudget: number;
  readonly horizonFrame: number;
}

/** What a simulation goes on from: opaque but for what its caller passes on, made only here. */
export interface SimulationState {
  readonly horizonFrame: number;
  /** The hand actions it holds, which a continuation's input begins with. */
  readonly hand: readonly HandAction[];
}

/** The simulation as a value it continues from, so a hand trigger costs its own events, not a new run. */
export interface PreviewSimulation {
  readonly log: PreviewEventLog;
  readonly state: SimulationState;
}

class SimulationRecord implements SimulationState {
  readonly horizonFrame: number;
  /** The frame before which it has forgotten everything; 0 where it has forgotten nothing. */
  readonly since: number;
  readonly plays: readonly EmitterPlay[];
  readonly hand: readonly HandAction[];
  readonly rate: SampleRate;
  readonly budget: number;
  /** The run at the horizon. */
  readonly run: SimulationRun;
  /** In order of frame, the first at {@link since}. */
  readonly snapshots: readonly Snapshot[];

  constructor(fields: Omit<SimulationRecord, never>) {
    this.horizonFrame = fields.horizonFrame;
    this.since = fields.since;
    this.plays = fields.plays;
    this.hand = fields.hand;
    this.rate = fields.rate;
    this.budget = fields.budget;
    this.run = fields.run;
    this.snapshots = fields.snapshots;
  }
}

function refused(code: string, summary: string): DomainFailure {
  return failure(code, FailureKind.Rejected, summary);
}

function isFrame(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Every reason `input` cannot be simulated. */
function inputProblems(
  input: PreviewInput,
  plays: readonly EmitterPlay[],
): readonly DomainFailure[] {
  const problems = [...previewScenarioProblems(input.scenario)];
  for (const play of plays) {
    if (play.pool.length === 0) {
      problems.push(
        refused(
          'preview.pool-empty',
          `The emitter ${quoted(play.emitter.name)} has nothing to play.`,
        ),
      );
    }
  }
  if (!Number.isSafeInteger(input.voiceBudget) || input.voiceBudget < 1) {
    problems.push(refused('preview.budget-invalid', 'A preview sounds at least one voice.'));
  }
  if (!isFrame(input.horizonFrame)) {
    problems.push(refused('preview.horizon-invalid', "A preview's horizon is a whole frame."));
  }
  const ids = new Set(input.scenario.emitters.map((emitter) => emitter.id));
  let last = 0;
  for (const action of input.hand) {
    if (!ids.has(action.emitter) || !isFrame(action.frame) || action.frame < last) {
      problems.push(
        refused(
          'preview.hand-invalid',
          'A hand action names an emitter of the scenario at a whole frame, in order of frame.',
        ),
      );
      break;
    }
    last = action.frame;
  }
  return problems;
}

/**
 * Whether two values the simulation was given are alike: the same, or arrays
 * or plain records of alike values, which a caller that kept its scenario and
 * rules answers at once by identity.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item: unknown, index) => sameValue(item, right[index]))
    );
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => sameValue(Reflect.get(left, key), Reflect.get(right, key)))
  );
}

/** The first frame at which `input` asks other than `record` decided, and whether it may go on from there. */
function continuationFrame(
  input: PreviewInput,
  record: SimulationRecord,
  plays: readonly EmitterPlay[],
): DomainResult<number> {
  const mismatch = fail(
    refused(
      'preview.continuation-mismatch',
      'A simulation goes on only from one of the same scenario, rules, pools, rate and budget, its hand actions kept.',
    ),
  );
  if (
    record.rate !== input.sampleRate ||
    record.budget !== input.voiceBudget ||
    !sameValue(record.plays, plays)
  ) {
    return mismatch;
  }
  let frame = Math.min(record.horizonFrame, input.horizonFrame);
  if (frame < record.since) return mismatch;
  for (const [index, action] of record.hand.entries()) {
    const now = input.hand[index];
    if (now?.kind !== action.kind || now.emitter !== action.emitter || now.frame !== action.frame) {
      return mismatch;
    }
  }
  const added = input.hand[record.hand.length];
  if (added !== undefined) frame = Math.min(frame, added.frame);
  return frame < record.since
    ? fail(
        refused(
          'preview.continuation-forgotten',
          'A simulation goes on only from a frame it has not forgotten.',
        ),
      )
    : succeed(frame);
}

/** The run of `record` at `frame`: every action before it taken and every voice ended before it gone. */
function runAt(context: StepContext, record: SimulationRecord, frame: number): SimulationRun {
  if (frame === record.horizonFrame) return record.run.copy();
  let from = record.snapshots[0];
  for (const snapshot of record.snapshots) if (snapshot.at <= frame) from = snapshot;
  if (from === undefined) throw new Error('A simulation keeps its first snapshot.');
  const run = from.run.copy();
  const silent = { ...context, emit: () => undefined };
  advance(silent, run, record.hand, frame);
  endVoicesBy(silent, run, frame - 1, false);
  return run;
}

/** The index of the first event at or after `frame` in `events`, which are in order of frame. */
function firstEventFrom(events: readonly PreviewEvent[], frame: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((events[middle]?.frame ?? 0) < frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * `input` simulated to its horizon, or, given `from`, the simulation it last
 * made, `from`'s events before the first frame the input asks otherwise and
 * the rest decided from there; refused where the input is invalid or `from`
 * was made of another scenario, rules, pools, rate or budget, or its hand
 * actions are not the input's first.
 */
export function simulatePreview(
  input: PreviewInput,
  from?: PreviewSimulation,
): DomainResult<PreviewSimulation> {
  const plays = emitterPlays(input.scenario, input.sampleRate, input.emitterRules, input.poolOf);
  const [problem, ...problems] = inputProblems(input, plays);
  if (problem !== undefined) return fail(problem, ...problems);
  const events: PreviewEvent[] = [];
  let forgotten = 0;
  let since = 0;
  const context: StepContext = {
    plays,
    rate: input.sampleRate,
    budget: input.voiceBudget,
    fade: fadeFrames(input.sampleRate),
    emit: (event) => events.push(event),
  };
  let run: SimulationRun;
  let snapshots: Snapshot[];
  if (from === undefined) {
    run = new SimulationRun(plays.map((play) => new EmitterRun(play.rules.voices.limit + 1)));
    snapshots = [{ at: 0, run: run.copy() }];
  } else {
    if (!(from.state instanceof SimulationRecord)) {
      return fail(
        refused('preview.continuation-mismatch', 'A simulation goes on only from one it made.'),
      );
    }
    const record = from.state;
    const frame = continuationFrame(input, record, plays);
    if (!frame.ok) return frame;
    run = runAt(context, record, frame.value);
    snapshots = record.snapshots.filter((snapshot) => snapshot.at <= frame.value);
    events.push(...from.log.events.slice(0, firstEventFrom(from.log.events, frame.value)));
    ({ forgotten } = from.log);
    ({ since } = record);
  }
  advance(context, run, input.hand, input.horizonFrame, snapshots);
  endVoicesBy(context, run, input.horizonFrame - 1, true);
  const state = new SimulationRecord({
    horizonFrame: input.horizonFrame,
    since,
    plays,
    hand: input.hand,
    rate: input.sampleRate,
    budget: input.voiceBudget,
    run,
    snapshots,
  });
  return succeed({ log: { events, horizonFrame: input.horizonFrame, forgotten }, state });
}

/** `run` with `taken` fewer hand actions taken, for a list of actions that lost its first `taken`. */
function withHandDropped(run: SimulationRun, taken: number): SimulationRun {
  const copied = run.copy();
  copied.handTaken -= taken;
  return copied;
}

/**
 * `simulation` with everything before `frame` forgotten: the events before it
 * dropped from its log, and from its state the snapshots before it and the hand
 * actions taken before it, a snapshot taken at it in their place; refused where
 * `frame` is past its horizon or it is no simulation made here. It goes on as
 * `simulation` would from `frame` or later, and from no earlier frame.
 */
export function forgetPreviewBefore(
  simulation: PreviewSimulation,
  frame: number,
): DomainResult<PreviewSimulation> {
  const record = simulation.state;
  if (!(record instanceof SimulationRecord)) {
    return fail(refused('preview.continuation-mismatch', 'A simulation forgets only one it made.'));
  }
  if (!isFrame(frame) || frame > record.horizonFrame) {
    return fail(
      refused('preview.forget-invalid', 'A simulation forgets up to a frame within its horizon.'),
    );
  }
  if (frame <= record.since) return succeed(simulation);
  const context: StepContext = {
    plays: record.plays,
    rate: record.rate,
    budget: record.budget,
    fade: fadeFrames(record.rate),
    emit: () => undefined,
  };
  const at = runAt(context, record, frame);
  const taken = at.handTaken;
  const kept = firstEventFrom(simulation.log.events, frame);
  return succeed({
    log: {
      events: simulation.log.events.slice(kept),
      horizonFrame: simulation.log.horizonFrame,
      forgotten: simulation.log.forgotten + kept,
    },
    state: new SimulationRecord({
      horizonFrame: record.horizonFrame,
      since: frame,
      plays: record.plays,
      hand: record.hand.slice(taken),
      rate: record.rate,
      budget: record.budget,
      run: withHandDropped(record.run, taken),
      snapshots: [
        { at: frame, run: withHandDropped(at, taken) },
        ...record.snapshots
          .filter((snapshot) => snapshot.at > frame)
          .map((snapshot) => ({ at: snapshot.at, run: withHandDropped(snapshot.run, taken) })),
      ],
    }),
  });
}

/**
 * What a simulation's emitters played by and at what rate, for the plan made
 * of it; `undefined` for a state no simulation here made.
 */
export function simulatedPlays(
  state: SimulationState,
): { readonly plays: readonly EmitterPlay[]; readonly rate: SampleRate } | undefined {
  return state instanceof SimulationRecord ? { plays: state.plays, rate: state.rate } : undefined;
}
