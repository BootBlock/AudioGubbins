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
 *
 * The person may choose the rate instead of the device, as the recording
 * diagnostics offer where an input runs at another rate than the context
 * (`ADR-0070`). The rate chosen is the one a context is made at wherever
 * nothing asks for a rate of its own: an input joining, or playback of what has
 * no rate, such as the test signal. Playback of an asset still asks for the
 * asset's own rate (`REQ-ARCH-085`), which wins, so playing an asset at another
 * rate makes the context again at that rate and closes an open input, as
 * before. The choice lasts while the page is open.
 */

import type { LatencyHint } from '@audiogubbins/audio-engine';
import type { Logger } from '@audiogubbins/diagnostics';
import type { ContextLifecycle } from '@audiogubbins/audio-runtime';

/** Makes a context's lifecycle for a hint, at a rate or the device's. */
export type MakeLifecycle = (
  latencyHint: LatencyHint,
  sampleRate: number | undefined,
) => ContextLifecycle;

/** Why the context a guest joined is closed for another. */
export type ContextReplacement =
  /** Playback needs a context of another latency hint or rate. */
  | { readonly kind: 'playback' }
  /** The person chose to run the context at `rate`. */
  | { readonly kind: 'rate-chosen'; readonly rate: number };

/** What joins the context without owning it: an open input. */
export interface ContextGuest {
  /**
   * Told once, before the context it joined is closed for another, and why,
   * so it lets go of what it made there; it has left the context by then.
   */
  readonly replaced: (why: ContextReplacement) => void;
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
  /** The rate the person chose, which a context is made at where nothing asks for one. */
  #chosenRate: number | undefined;

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
      this.#replace(held, { kind: 'playback' });
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

  /**
   * Makes the context at `rate` wherever nothing asks for a rate of its own,
   * from now on: the context held now, unless it runs at `rate`, is closed,
   * its guests told why first, and the next one asked for is made at `rate`.
   * Playback lets go of the context before this is asked.
   */
  chooseRate(rate: number): void {
    this.#chosenRate = rate;
    const held = this.#held;
    if (held === undefined || runsAt(held, rate)) return;
    if (held.owned) {
      // A wiring mistake: closing playback's context under it would leave its
      // session playing into a closed context.
      throw new Error(
        'The audio context is owned; playback lets go of it before a rate is chosen.',
      );
    }
    this.#replace(held, { kind: 'rate-chosen', rate });
  }

  /** Joins the context there is, or has one made of `latencyHint` at the chosen rate or the device's. */
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

  #made(latencyHint: LatencyHint, asked: number | undefined): Held {
    const rate = asked ?? this.#chosenRate;
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

  /** Tells the guests of `held` it is going, and why, and closes it. */
  #replace(held: Held, why: ContextReplacement): void {
    const guests = [...held.guests];
    held.guests.clear();
    for (const guest of guests) guest.replaced(why);
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
  return rate === undefined || runsAt(held, rate);
}

/** Whether `held` runs at `rate`: made at it, or found to run at it once it reported. */
function runsAt(held: Held, rate: number): boolean {
  return held.rate === rate || held.lifecycle.report?.sampleRate === rate;
}
