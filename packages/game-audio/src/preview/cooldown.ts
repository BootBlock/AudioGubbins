/**
 * An emitter's cooldown (ADR-0104): the least time from one trigger it started
 * to the next it may start.
 *
 * The cooldown is `framesOf(cooldownMilliseconds, rate)` frames, and strict: a
 * trigger at `t` is suppressed where `t − t_last < c`, `t_last` the frame of
 * the last trigger that started a voice, so one exactly `c` frames on starts.
 * Only a started trigger moves `t_last`: one suppressed, or one the voice
 * limit or the preview's budget rejects, leaves it, as it leaves the selection
 * history, so a burst of refused triggers never holds an emitter silent.
 */

import { framesOf } from './preview-draws.js';

/** The cooldown of `milliseconds` at `rate`, in frames. */
export function cooldownFrames(milliseconds: number, rate: number): number {
  return framesOf(milliseconds, rate);
}

/** Whether a trigger at `frame` falls within `cooldown` frames of the last started one. */
export function suppressedBy(
  frame: number,
  lastStarted: number | undefined,
  cooldown: number,
): boolean {
  return lastStarted !== undefined && frame - lastStarted < cooldown;
}
