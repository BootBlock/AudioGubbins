/**
 * The page's one audio context, shared by playback and an open input
 * (`ADR-0070`).
 *
 * Capture runs in the playback context, so recording while playing, a count-in
 * and a punch share one media clock: a second context would give them two. So
 * the context's life is held here rather than by playback alone. Playback owns
 * it: a context keeps its latency hint and its rate for its life, so playback
 * asks for the hint and rate it needs, and a context that suits neither is
 * closed and another made. An open input joins whatever context there is, or
 * has one made at the device's rate, and is told, before its context is closed
 * to make another, so it closes the input and says why. A context closes once
 * neither playback nor any input holds it.
 */

import type { LatencyHint } from '@audiogubbins/audio-engine';
import type { Logger } from '@audiogubbins/diagnostics';
import type { ContextLifecycle } from '@audiogubbins/audio-runtime';

/** Makes a context's lifecycle for a hint, at a rate or the device's. */
export type MakeLifecycle = (
  latencyHint: LatencyHint,
  sampleRate: number | undefined,
) => ContextLifecycle;

/** What joins the context without owning it: an open input. */
export interface ContextGuest {
  /**
   * Told once, before the context it joined is closed for playback's sake,
   * so it lets go of what it made there; it has left the context by then.
   */
  readonly replaced: () => void;
}

/** A hold on the context, and how to let go of it. */
export interface ContextHold {
  readonly lifecycle: ContextLifecycle;
  /** Lets go; the context closes once nothing holds it. Letting go twice is letting go once. */
  readonly release: () => void;
}

/** The context now, what it was made for, and what holds it. */
interface Held {
  readonly lifecycle: ContextLifecycle;
  readonly latencyHint: LatencyHint;
  readonly rate: number | undefined;
  owned: boolean;
  readonly guests: Set<ContextGuest>;
}

/** Holds the page's one audio context for playback and the inputs. */
export class AudioContextHost {
  readonly #make: MakeLifecycle;
  readonly #logger: Logger;
  #held: Held | undefined;

  constructor(make: MakeLifecycle, logger: Logger) {
    this.#make = make;
    this.#logger = logger;
  }

  /** The context now, where one is held. */
  current(): ContextLifecycle | undefined {
    return this.#held?.lifecycle;
  }

  /**
   * Owns a context of `latencyHint` at `rate`, or at whatever rate the context
   * runs where `rate` is `undefined`: the one there is where it suits, or a new
   * one, the old closed and its guests told first.
   */
  own(latencyHint: LatencyHint, rate: number | undefined): ContextHold {
    let held = this.#held;
    if (held?.owned === true) {
      // A wiring mistake: playback lets go of one context before it asks for another.
      throw new Error('The audio context is owned already; release it first.');
    }
    if (held !== undefined && !suits(held, latencyHint, rate)) {
      this.#replace(held);
      held = undefined;
    }
    held ??= this.#made(latencyHint, rate);
    held.owned = true;
    const owned = held;
    return {
      lifecycle: owned.lifecycle,
      release: () => {
        if (this.#held !== owned || !owned.owned) return;
        owned.owned = false;
        this.#closeIfFree(owned);
      },
    };
  }

  /** Joins the context there is, or has one made of `latencyHint` at the device's rate. */
  join(guest: ContextGuest, latencyHint: LatencyHint): ContextHold {
    const held = this.#held ?? this.#made(latencyHint, undefined);
    held.guests.add(guest);
    return {
      lifecycle: held.lifecycle,
      release: () => {
        if (this.#held !== held || !held.guests.delete(guest)) return;
        this.#closeIfFree(held);
      },
    };
  }

  /** Closes the context, whatever holds it, for good. */
  async close(): Promise<void> {
    const held = this.#held;
    this.#held = undefined;
    await held?.lifecycle.close();
  }

  #made(latencyHint: LatencyHint, rate: number | undefined): Held {
    const held: Held = {
      lifecycle: this.#make(latencyHint, rate),
      latencyHint,
      rate,
      owned: false,
      guests: new Set(),
    };
    this.#held = held;
    return held;
  }

  /** Tells the guests of `held` it is going, and closes it. */
  #replace(held: Held): void {
    const guests = [...held.guests];
    held.guests.clear();
    for (const guest of guests) guest.replaced();
    this.#closeIfFree(held);
  }

  #closeIfFree(held: Held): void {
    if (held.owned || held.guests.size > 0) return;
    if (this.#held === held) this.#held = undefined;
    // Nothing waits on the close, so a fault in it is recorded here, where the
    // diagnostic log shows it, rather than left to reach no one.
    void held.lifecycle.close().catch((error: unknown) => {
      this.#logger.error('The audio context could not be closed.', {
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * Whether `held` suits a hint and a rate: the same hint, and the rate asked
 * for, or any rate where none is, the rate it runs at counting once known.
 */
function suits(held: Held, latencyHint: LatencyHint, rate: number | undefined): boolean {
  if (held.latencyHint !== latencyHint) return false;
  return rate === undefined || held.rate === rate || held.lifecycle.report?.sampleRate === rate;
}
