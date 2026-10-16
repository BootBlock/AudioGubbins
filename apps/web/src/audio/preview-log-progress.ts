/**
 * What a run of the game preview has been heard to do, as the panel lists it
 * (ADR-0104): the events up to the frame the listener hears, the voices each
 * emitter sounds against its limit, a count of each kind of event, and how late
 * the last hand trigger was heard.
 *
 * Only events the listener has heard are taken: a continuation decides afresh
 * only from a frame the feeder has not read, which is never before the frame
 * heard, so the events taken are never changed under the list, and the place it
 * has reached in the log stays the place of the same event. Each is taken once,
 * so a long run costs its new events at each look.
 */

import type { PreviewEmitterId, PreviewEventLog } from '@audiogubbins/game-audio';

import {
  NO_EVENTS,
  RECENT_EVENTS,
  type EventCounts,
  type PreviewRunStats,
} from '../state/game-preview-store.js';
import type { PreviewSetup } from './preview-setup.js';

/** The list of a run's heard events, kept as it hears them. */
export class LogProgress {
  readonly #setup: PreviewSetup;
  readonly #limits: ReadonlyMap<PreviewEmitterId, number>;
  /** The voices each emitter sounds, by number. */
  readonly #sounding = new Map<PreviewEmitterId, Set<number>>();
  #taken = 0;
  #recent: PreviewRunStats['recent'] = [];
  #counts: EventCounts = NO_EVENTS;
  /** The hand triggers not yet heard: the frame each starts at, and when it was pressed. */
  #waiting: { readonly frame: number; readonly pressed: number }[] = [];
  #latency: number | undefined;

  constructor(setup: PreviewSetup) {
    this.#setup = setup;
    this.#limits = new Map(
      setup.scenario.emitters.map((emitter) => [
        emitter.id,
        setup.subjects.emitterRules(emitter.subject).voices.limit,
      ]),
    );
  }

  /** That a hand trigger pressed at `pressed` milliseconds is played from `frame`. */
  pressed(frame: number, pressed: number): void {
    this.#waiting.push({ frame, pressed });
  }

  /**
   * Takes every event of `log` the listener has heard by frame `heard`, at
   * `now` milliseconds, and answers whether anything the panel shows changed.
   */
  hear(log: PreviewEventLog, heard: number, now: number): boolean {
    const { events } = log;
    const before = this.#taken;
    const recent = [...this.#recent];
    const counts = { ...this.#counts };
    for (; this.#taken < events.length; this.#taken += 1) {
      const event = events[this.#taken];
      if (event === undefined || event.frame > heard) break;
      counts[event.kind] += 1;
      recent.push(event);
      if (event.kind === 'started') {
        const own = this.#sounding.get(event.emitter) ?? new Set<number>();
        own.add(event.voice);
        this.#sounding.set(event.emitter, own);
      } else if ('voice' in event) {
        this.#sounding.get(event.emitter)?.delete(event.voice);
      }
    }
    const waited = this.#waiting.length;
    this.#waiting = this.#waiting.filter((one) => {
      if (one.frame > heard) return true;
      this.#latency = now - one.pressed;
      return false;
    });
    if (this.#taken === before && waited === this.#waiting.length) return false;
    this.#recent = recent.slice(-RECENT_EVENTS);
    this.#counts = counts;
    return true;
  }

  /** What the panel shows, with the plan's `planStreams`. */
  stats(planStreams: number): PreviewRunStats {
    return {
      scenario: this.#setup.scenario.id,
      budget: this.#setup.budget,
      latencyMilliseconds: this.#latency,
      recent: this.#recent,
      counts: this.#counts,
      voices: new Map(
        [...this.#limits].map(([emitter, limit]) => [
          emitter,
          { sounding: this.#sounding.get(emitter)?.size ?? 0, limit },
        ]),
      ),
      planStreams,
    };
  }
}
