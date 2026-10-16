/**
 * The order a game preview's simulation takes its actions in (ADR-0104): each
 * emitter's next repeat trigger by its frame, a neighbour taken first where
 * rounding put it a frame or two ahead (`trigger-schedule.ts`), and the next
 * hand action, the earliest first; at one frame, by the emitters' identifiers,
 * an emitter's repeat before its hand actions, and hand actions as given. Each
 * is taken after the voices that ended by its frame (`simulation-steps.ts`).
 */

import type { EmitterRun, PendingRepeat, SimulationRun, Snapshot } from './simulation-run.js';
import { endVoicesBy, stop, trigger, type StepContext } from './simulation-steps.js';
import { repeatFrame, type EmitterPlay, type HandAction } from './trigger-schedule.js';

/** How many actions apart the snapshots a continuation goes on from are taken. */
const SNAPSHOT_ACTIONS = 256;

/** The repeat `play` takes next, worked out where it is not yet. */
function pendingRepeat(
  play: EmitterPlay,
  state: EmitterRun,
  rate: number,
): PendingRepeat | undefined {
  if (state.pending !== undefined || state.cursor >= play.count) return state.pending;
  const k = state.cursor;
  const here = repeatFrame(play, k, rate);
  if (!state.skip && k + 1 < play.count) {
    const next = repeatFrame(play, k + 1, rate);
    if (next < here) {
      state.pending = { k: k + 1, frame: next, ahead: true };
      return state.pending;
    }
  }
  state.pending = { k, frame: here, ahead: false };
  return state.pending;
}

/** Takes the repeat `pendingRepeat` gave. */
function takeRepeat(state: EmitterRun, ahead: boolean): void {
  if (ahead) state.skip = true;
  else {
    state.cursor += state.skip ? 2 : 1;
    state.skip = false;
  }
  state.pending = undefined;
}

/** The next action before `until`: an emitter's repeat or the next hand action, or none. */
function nextAction(
  context: StepContext,
  run: SimulationRun,
  hand: readonly HandAction[],
  places: ReadonlyMap<string, number>,
  until: number,
): { readonly frame: number; readonly take: () => void } | undefined {
  let chosen: { emitter: number; frame: number; rank: number } | undefined;
  for (const [emitter, play] of context.plays.entries()) {
    const state = run.emitters[emitter];
    const pending = state === undefined ? undefined : pendingRepeat(play, state, context.rate);
    if (pending === undefined || pending.frame >= until) continue;
    if (
      chosen === undefined ||
      pending.frame < chosen.frame ||
      (pending.frame === chosen.frame && play.rank < chosen.rank)
    ) {
      chosen = { emitter, frame: pending.frame, rank: play.rank };
    }
  }
  const action = hand[run.handTaken];
  const actor = action === undefined ? undefined : places.get(action.emitter);
  const actorRank = actor === undefined ? undefined : context.plays[actor]?.rank;
  if (
    action !== undefined &&
    actor !== undefined &&
    actorRank !== undefined &&
    action.frame < until &&
    (chosen === undefined ||
      action.frame < chosen.frame ||
      (action.frame === chosen.frame && actorRank < chosen.rank))
  ) {
    return {
      frame: action.frame,
      take: () => {
        takeHand(context, run, action, actor);
      },
    };
  }
  if (chosen === undefined) return undefined;
  const { emitter, frame } = chosen;
  return {
    frame,
    take: () => {
      const state = run.emitters[emitter];
      const pending = state?.pending;
      if (state === undefined || pending === undefined) return;
      takeRepeat(state, pending.ahead);
      trigger(context, run, emitter, frame, pending.k);
    },
  };
}

function takeHand(
  context: StepContext,
  run: SimulationRun,
  action: HandAction,
  emitter: number,
): void {
  run.handTaken += 1;
  if (action.kind === 'stop') {
    stop(context, run, emitter, action.frame);
    return;
  }
  const state = run.emitters[emitter];
  const play = context.plays[emitter];
  if (state === undefined || play === undefined) return;
  const ordinal = play.count + state.handTaken;
  state.handTaken += 1;
  trigger(context, run, emitter, action.frame, ordinal);
}

/**
 * Takes every action of `run` before `until`, each after the voices that ended
 * by its frame; `snapshots`, where given, gains a copy of the run every
 * {@link SNAPSHOT_ACTIONS} actions.
 */
export function advance(
  context: StepContext,
  run: SimulationRun,
  hand: readonly HandAction[],
  until: number,
  snapshots?: Snapshot[],
): void {
  const places = new Map(context.plays.map((play, index) => [play.emitter.id, index]));
  let taken = 0;
  let lastFrame = -1;
  for (let action = nextAction(context, run, hand, places, until); action !== undefined;) {
    if (snapshots !== undefined && taken >= SNAPSHOT_ACTIONS && action.frame > lastFrame) {
      snapshots.push({ at: action.frame, run: run.copy() });
      taken = 0;
    }
    endVoicesBy(context, run, action.frame, true);
    action.take();
    taken += 1;
    lastFrame = action.frame;
    action = nextAction(context, run, hand, places, until);
  }
}
