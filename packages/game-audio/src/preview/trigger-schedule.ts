/**
 * When each emitter of a game preview is triggered, and what it plays by
 * (ADR-0104): what the simulation reads of its input for one emitter, and
 * the actions taken by hand.
 *
 * A repeat's trigger `k` is at
 * `t_k = max(0, framesOf(k·interval, fs) + ⌊u·(2J + 1)⌋ − J)`, with
 * `J = framesOf(jitter, fs)` and `u` the trigger's jitter draw. Jitter is at
 * most half the interval, so two triggers can change places only with their
 * neighbour, by a frame or two of rounding; the triggers are taken in order of
 * their frames, a tie in order of `k`.
 */

import type { SampleRate } from '@audiogubbins/domain';

import type { EmitterRules } from '../policy/playback-rules.js';
import { cooldownFrames } from './cooldown.js';
import { DrawStream, choiceOf, drawWord, emitterKey, framesOf } from './preview-draws.js';
import type {
  GamePreviewScenario,
  PreviewEmitter,
  PreviewEmitterId,
  PreviewSubject,
} from './preview-scenario.js';
import type { PoolMember } from './preview-subjects.js';

/** A trigger or a stop of every voice of one emitter, by hand, at a frame. */
export interface HandAction {
  readonly kind: 'trigger' | 'stop';
  readonly emitter: PreviewEmitterId;
  readonly frame: number;
}

/** What one emitter plays by, for one simulation. */
export interface EmitterPlay {
  readonly emitter: PreviewEmitter;
  /** Its place among the scenario's emitters ordered by identifier, which breaks every tie. */
  readonly rank: number;
  readonly key: number;
  readonly rules: EmitterRules;
  readonly pool: readonly PoolMember[];
  readonly cooldown: number;
  /** The repeat's triggers; none where it is triggered by hand alone. */
  readonly count: number;
}

/** Each emitter of `scenario` with what it plays by, in the scenario's order. */
export function emitterPlays(
  scenario: GamePreviewScenario,
  rate: SampleRate,
  emitterRules: (subject: PreviewSubject) => EmitterRules,
  poolOf: (subject: PreviewSubject) => readonly PoolMember[],
): readonly EmitterPlay[] {
  const ranks = scenario.emitters
    .map((emitter) => emitter.id)
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return scenario.emitters.map((emitter) => {
    const rules = emitterRules(emitter.subject);
    return {
      emitter,
      rank: ranks.indexOf(emitter.id),
      key: emitterKey(scenario.seed, emitter.id),
      rules,
      pool: poolOf(emitter.subject),
      cooldown: cooldownFrames(rules.cooldownMilliseconds, rate),
      count: emitter.trigger.kind === 'repeat' ? emitter.trigger.count : 0,
    };
  });
}

/** The frame of repeat trigger `k` of `play` at `rate`. */
export function repeatFrame(play: EmitterPlay, k: number, rate: number): number {
  const { trigger } = play.emitter;
  if (trigger.kind !== 'repeat') throw new Error('Only a repeat has repeat triggers.');
  const jitter = framesOf(trigger.jitterMilliseconds, rate);
  const moved = choiceOf(drawWord(play.key, DrawStream.Jitter, k), 2 * jitter + 1) - jitter;
  return Math.max(0, framesOf(k * trigger.intervalMilliseconds, rate) + moved);
}
