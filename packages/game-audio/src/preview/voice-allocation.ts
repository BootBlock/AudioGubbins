/**
 * Voices and lanes (ADR-0104): which voice a full emitter steals, and which
 * lane a new voice sounds in.
 *
 * An emitter sounds at most its limit of voices. Past it, `oldest` steals the
 * voice that started earliest, `quietest` the one of the lowest gain in
 * decibels (ties: the oldest), and `reject` starts nothing. Among voices that
 * started on one frame the oldest is the one of the lower emitter (emitters in
 * the order of their identifiers, as the simulation takes them), then the
 * lower lane. A stolen or stopped voice stops counting at once and fades out
 * over {@link FADE_MILLISECONDS}.
 *
 * Each voice sounds in a lane, a stream of the preview's plan that holds one
 * voice at a time: a new voice takes the lowest lane free at its frame, free
 * once the sound of the voice before it, its fade included, has ended. A fading
 * voice and its replacement therefore never share a lane, so an emitter needs
 * `limit + 1` lanes; it takes another only where two of its voices fade at
 * once, which a second steal within one fade's length makes.
 */

import type { VoiceStealing } from '../policy/playback-rules.js';

/** How long a stolen or stopped voice takes to fade out. */
export const FADE_MILLISECONDS = 5;

/** A voice that counts against its emitter's limit and the preview's budget. */
export interface SoundingVoice {
  readonly voice: number;
  /** The emitter's place among the scenario's emitters ordered by identifier. */
  readonly rank: number;
  readonly lane: number;
  readonly start: number;
  readonly gainDecibels: number;
}

/** Whether `left` started before `right`, by frame, then emitter, then lane. */
function older(left: SoundingVoice, right: SoundingVoice): boolean {
  if (left.start !== right.start) return left.start < right.start;
  if (left.rank !== right.rank) return left.rank < right.rank;
  return left.lane < right.lane;
}

/** Whether `stealing` takes `left` before `right`. */
function before(
  stealing: Exclude<VoiceStealing, 'reject'>,
  left: SoundingVoice,
  right: SoundingVoice,
): boolean {
  if (stealing === 'quietest' && left.gainDecibels !== right.gainDecibels) {
    return left.gainDecibels < right.gainDecibels;
  }
  return older(left, right);
}

/** The voice of `voices` (at least one) that `stealing` takes. */
export function victimOf<V extends SoundingVoice>(
  voices: Iterable<V>,
  stealing: Exclude<VoiceStealing, 'reject'>,
): V {
  let chosen: V | undefined;
  for (const voice of voices) {
    if (chosen === undefined || before(stealing, voice, chosen)) chosen = voice;
  }
  if (chosen === undefined) throw new Error('A full emitter has a voice to steal.');
  return chosen;
}

/**
 * The lowest lane free at `frame`, given the frame each lane is free from, or
 * the next lane where none is.
 */
export function lowestFreeLane(freeFrom: readonly number[], frame: number): number {
  for (const [lane, free] of freeFrom.entries()) if (free <= frame) return lane;
  return freeFrom.length;
}
