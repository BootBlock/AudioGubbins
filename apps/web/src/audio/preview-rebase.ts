/**
 * Keeping a long run's plan from growing without end (ADR-0104).
 *
 * A preview plan keeps the streams of every voice it ever laid, at their
 * places, so a continuation keeps every reader of what is sounding; and the
 * feeder compares every stream and segment of the old plan with the new one
 * at each continuation. Over a long run, triggered by hand or by a pattern,
 * that is a plan and a comparison that grow with every trigger.
 *
 * So a run lays its plan again from a frame at which nothing sounds: the plan
 * is made afresh from the events from that frame on, the voices numbered from
 * the first of them, and the transport goes on into it there. Every reader is
 * made afresh at that frame, which nothing sounding can hear: each lane is
 * silent, so each panner, bus gain and the output read silence on both sides.
 * The simulation is untouched, so the log, every later choice and what the
 * seed decides are what they would have been.
 */

import type { PreviewEvent, PreviewSimulation } from '@audiogubbins/game-audio';

/** Where a run's plan was last laid afresh: from `frame`, its voices numbered from `voice`. */
export interface Rebase {
  readonly frame: number;
  readonly voice: number;
}

/** A plan laid from the start. */
export const FROM_THE_START: Rebase = { frame: 0, voice: 0 };

/**
 * How long a cut voice is taken to sound after its cut: longer than the 5 ms
 * fade a stolen or stopped voice takes, so a voice still fading is never taken
 * for silence.
 */
const CUT_SOUNDS_SECONDS = 0.01;

/** The index of the first of `events`, which are in order of frame, at or after `frame`. */
function firstFrom(events: readonly PreviewEvent[], frame: number): number {
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
 * `simulation` as the plan laid from `rebase` reads it: the events from its
 * frame on, each voice numbered from its first. A voice it names before that
 * had ended before it, so only its own end, which a plan does not read, is left
 * out with it.
 */
export function rebasedView(simulation: PreviewSimulation, rebase: Rebase): PreviewSimulation {
  if (rebase.frame === 0) return simulation;
  const { events } = simulation.log;
  const kept: PreviewEvent[] = [];
  for (let index = firstFrom(events, rebase.frame); index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) break;
    if (!('voice' in event)) kept.push(event);
    else if (event.voice >= rebase.voice)
      kept.push({ ...event, voice: event.voice - rebase.voice });
  }
  return {
    log: { events: kept, horizonFrame: simulation.log.horizonFrame },
    state: simulation.state,
  };
}

/** How many voices the plan laid from `rebase` holds. */
export function voicesLaid(simulation: PreviewSimulation, rebase: Rebase): number {
  const { events } = simulation.log;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === 'started') return event.voice + 1 - rebase.voice;
  }
  return 0;
}

/**
 * The rebase at `frame` where nothing `simulation` started before it sounds
 * there, at `rate`, and `undefined` where something does. Every voice before
 * `since` had ended by it, so only the events from there are read.
 */
export function quietAt(
  simulation: PreviewSimulation,
  since: Rebase,
  frame: number,
  rate: number,
): Rebase | undefined {
  const { events } = simulation.log;
  const cutSounds = Math.ceil(CUT_SOUNDS_SECONDS * rate);
  const sounding = new Set<number>();
  let next = since.voice;
  for (let index = firstFrom(events, since.frame); index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined || event.frame >= frame) break;
    switch (event.kind) {
      case 'started':
        sounding.add(event.voice);
        next = event.voice + 1;
        break;
      case 'ended':
        sounding.delete(event.voice);
        break;
      case 'stolen':
      case 'budget-stolen':
      case 'stopped':
        if (event.frame + cutSounds <= frame) sounding.delete(event.voice);
        break;
      default:
        break;
    }
  }
  return sounding.size === 0 ? { frame, voice: next } : undefined;
}
