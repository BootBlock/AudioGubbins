/**
 * One action of a game preview's simulation (ADR-0104): a trigger decided in
 * the order section 6 of the phase plan states, a stop by hand, and the voices
 * that ended before either.
 *
 * A trigger at frame `t` of emitter `e`, its ordinal `k`:
 *
 * 1. Cooldown: suppressed within `e`'s cooldown of the last trigger it started
 *    (`cooldown.ts`).
 * 2. Selection: a member of `e`'s pool by its rule (`selection.ts`).
 * 3. Variation, by the chosen member's own: pitch `min + ⌊u·(max − min + 1)⌋`
 *    cents, gain `min + u·(max − min)` dB, offset `⌊u·(min(M, S − 1) + 1)⌋`
 *    of the member's frames, `M` the most offset in its frames and `S` its
 *    length, or its loop's end where it loops.
 * 4. Voices: with `e` at its limit, its stealing rule steals or rejects;
 *    otherwise, with the preview at its budget, the same rule across every
 *    emitter, logged `budget-stolen` or `budget-rejected` (`voice-allocation.ts`).
 * 5. The voice starts in the lowest lane free.
 *
 * A voice played to its end lasts its member's frames from its offset, played
 * at its pitch's ratio where it has one (`convertedFrameCount` by the ratio's
 * steps) and converted to the preview's rate where the member's differs (by
 * the rates); a voice of a loop lasts until it is stolen or stopped.
 */

import { VARISPEED_DENOMINATOR, convertedFrameCount } from '@audiogubbins/domain';

import { suppressedBy } from './cooldown.js';
import type { PreviewEvent } from './preview-event-log.js';
import {
  DrawStream,
  choiceOf,
  drawWord,
  fractionOf,
  framesOf,
  pitchNumerator,
} from './preview-draws.js';
import type { PoolMember } from './preview-subjects.js';
import { chooseMember, withChoice } from './selection.js';
import type { EmitterRun, SimulationRun, Voice } from './simulation-run.js';
import type { EmitterPlay } from './trigger-schedule.js';
import { FADE_MILLISECONDS, lowestFreeLane, victimOf } from './voice-allocation.js';

/** What every step of one simulation reads. */
export interface StepContext {
  readonly plays: readonly EmitterPlay[];
  readonly rate: number;
  readonly budget: number;
  readonly fade: number;
  readonly emit: (event: PreviewEvent) => void;
}

/** The frames a stolen or stopped voice fades over at `rate`. */
export function fadeFrames(rate: number): number {
  return framesOf(FADE_MILLISECONDS, rate);
}

/** How long a voice of `member` from `offset` at `cents` sounds at `rate`, played to its end. */
export function voiceFrames(
  member: PoolMember,
  offset: number,
  cents: number,
  rate: number,
): number {
  if (member.loop !== undefined) return Number.POSITIVE_INFINITY;
  let frames = member.length - offset;
  const numerator = pitchNumerator(cents);
  if (numerator !== VARISPEED_DENOMINATOR) {
    frames = convertedFrameCount(frames, numerator, VARISPEED_DENOMINATOR);
  }
  return member.sampleRate === rate ? frames : convertedFrameCount(frames, member.sampleRate, rate);
}

function playOf(context: StepContext, emitter: number): EmitterPlay {
  const play = context.plays[emitter];
  if (play === undefined) throw new Error('A simulation steps only its own emitters.');
  return play;
}

function emitterOf(run: SimulationRun, emitter: number): EmitterRun {
  const state = run.emitters[emitter];
  if (state === undefined) throw new Error('A simulation runs each of its emitters.');
  return state;
}

/** Ends every voice still sounding that ended by `frame`, each logged where `log` says. */
export function endVoicesBy(
  context: StepContext,
  run: SimulationRun,
  frame: number,
  log: boolean,
): void {
  for (let entry = run.ends.popBy(frame); entry !== undefined; entry = run.ends.popBy(frame)) {
    const state = emitterOf(run, entry.emitter);
    const at = state.sounding.findIndex((voice) => voice.voice === entry.voice);
    if (at < 0) continue;
    state.sounding.splice(at, 1);
    run.sounding -= 1;
    if (log) {
      context.emit({
        kind: 'ended',
        frame: entry.end,
        emitter: playOf(context, entry.emitter).emitter.id,
        voice: entry.voice,
      });
    }
  }
}

/** Stops `voice` sounding at `frame`, its sound fading out, logged as `kind`. */
function cut(
  context: StepContext,
  run: SimulationRun,
  voice: Voice,
  frame: number,
  kind: 'stolen' | 'budget-stolen' | 'stopped',
): void {
  const state = emitterOf(run, voice.emitter);
  state.sounding.splice(state.sounding.indexOf(voice), 1);
  state.laneFree[voice.lane] = Math.min(voice.end, frame + context.fade);
  run.sounding -= 1;
  context.emit({
    kind,
    frame,
    emitter: playOf(context, voice.emitter).emitter.id,
    voice: voice.voice,
  });
}

/** Stops every voice of `emitter` sounding at `frame`. */
export function stop(
  context: StepContext,
  run: SimulationRun,
  emitter: number,
  frame: number,
): void {
  for (const voice of [...emitterOf(run, emitter).sounding])
    cut(context, run, voice, frame, 'stopped');
}

/** Makes room for one voice of `emitter` at `frame`, or says which refusal it met. */
function room(
  context: StepContext,
  run: SimulationRun,
  emitter: number,
  frame: number,
): 'rejected' | 'budget-rejected' | undefined {
  const play = playOf(context, emitter);
  const { limit, stealing } = play.rules.voices;
  const state = emitterOf(run, emitter);
  if (state.sounding.length >= limit) {
    if (stealing === 'reject') return 'rejected';
    cut(context, run, victimOf(state.sounding, stealing), frame, 'stolen');
    return undefined;
  }
  if (run.sounding < context.budget) return undefined;
  if (stealing === 'reject') return 'budget-rejected';
  const everyVoice = run.emitters.flatMap((one) => one.sounding);
  cut(context, run, victimOf(everyVoice, stealing), frame, 'budget-stolen');
  return undefined;
}

/** The pool member a trigger plays and the variation it draws. */
interface Choice {
  readonly index: number;
  readonly member: PoolMember;
  readonly pitchCents: number;
  readonly gainDecibels: number;
  readonly offsetFrames: number;
}

function choose(play: EmitterPlay, state: EmitterRun, trigger: number): Choice {
  const word = (stream: (typeof DrawStream)[keyof typeof DrawStream]): number =>
    drawWord(play.key, stream, trigger);
  const index = chooseMember(
    play.rules.selection,
    play.pool.length,
    state.recent,
    word(DrawStream.Selection),
  );
  const member = play.pool[index];
  if (member === undefined) throw new Error('A choice is a member of the pool.');
  const { pitchCents: pitch, gainDecibels: gain, startOffsetMilliseconds } = member.variation;
  const span = member.loop?.end ?? member.length;
  const most = Math.min(framesOf(startOffsetMilliseconds.max, member.sampleRate), span - 1);
  return {
    index,
    member,
    pitchCents: pitch.min + choiceOf(word(DrawStream.Pitch), pitch.max - pitch.min + 1),
    gainDecibels: gain.min + fractionOf(word(DrawStream.Gain)) * (gain.max - gain.min),
    offsetFrames: choiceOf(word(DrawStream.Offset), most + 1),
  };
}

/** Decides the trigger of ordinal `ordinal` of `emitter` at `frame`. */
export function trigger(
  context: StepContext,
  run: SimulationRun,
  emitter: number,
  frame: number,
  ordinal: number,
): void {
  const play = playOf(context, emitter);
  const state = emitterOf(run, emitter);
  const id = play.emitter.id;
  if (suppressedBy(frame, state.lastStarted, play.cooldown)) {
    context.emit({ kind: 'suppressed', frame, emitter: id, trigger: ordinal });
    return;
  }
  const choice = choose(play, state, ordinal);
  const refused = room(context, run, emitter, frame);
  if (refused !== undefined) {
    context.emit({ kind: refused, frame, emitter: id, trigger: ordinal });
    return;
  }
  const lane = lowestFreeLane(state.laneFree, frame);
  const length = voiceFrames(choice.member, choice.offsetFrames, choice.pitchCents, context.rate);
  const voice: Voice = {
    voice: run.nextVoice,
    emitter,
    rank: play.rank,
    lane,
    start: frame,
    gainDecibels: choice.gainDecibels,
    end: frame + length,
  };
  run.nextVoice += 1;
  run.sounding += 1;
  state.sounding.push(voice);
  state.laneFree[lane] = voice.end;
  if (Number.isFinite(voice.end)) run.ends.push({ end: voice.end, voice: voice.voice, emitter });
  state.lastStarted = frame;
  state.recent = withChoice(state.recent, choice.index);
  context.emit({
    kind: 'started',
    frame,
    emitter: id,
    trigger: ordinal,
    voice: voice.voice,
    lane,
    member: choice.member.member,
    pitchCents: choice.pitchCents,
    gainDecibels: choice.gainDecibels,
    offsetFrames: choice.offsetFrames,
    bus: choice.member.bus,
  });
}
