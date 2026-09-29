/**
 * Tells a run's pumps, on a timer, how much the processor has consumed.
 *
 * The processor consumes one quantum of every feed for each quantum it runs,
 * so what it has consumed since it said `started` is the context frames since
 * then, read off the main thread's own clock (see `feed/feed-pump.ts`). That
 * reading lags the audio thread, never leads it, so a pump that trusts it
 * never sends past its bound. The ticker holds that one rule and the timer
 * that applies it; it starts at the processor's `started` and stops with the
 * run.
 */

import type { Schedule } from '../schedule.js';

/** What a ticker reads and whom it tells. */
export interface ConsumptionTickerOptions {
  readonly schedule: Schedule;
  readonly intervalMilliseconds: number;
  /** The context frame the main thread's clock has reached. */
  readonly contextFrame: () => number;
  /** Hears the frames consumed since the start, in total. */
  readonly tick: (consumedFrames: number) => void;
}

/** A timer that reports the frames consumed since a context frame. */
export class ConsumptionTicker {
  readonly #options: ConsumptionTickerOptions;
  readonly #startedAt: number;
  #cancel: (() => void) | undefined;
  #stopped = false;

  /** Ticks from `startedAt`, the context frame the processor started at, until stopped. */
  constructor(options: ConsumptionTickerOptions, startedAt: number) {
    this.#options = options;
    this.#startedAt = startedAt;
    this.#next();
  }

  stop(): void {
    this.#stopped = true;
    this.#cancel?.();
    this.#cancel = undefined;
  }

  #next(): void {
    this.#cancel = this.#options.schedule(() => {
      // The frame the processor started at may still be ahead of a clock that
      // lags it, and nothing has been consumed before it.
      this.#options.tick(Math.max(0, this.#options.contextFrame() - this.#startedAt));
      // A tick's listener may have stopped the run it belongs to.
      if (!this.#stopped) this.#next();
    }, this.#options.intervalMilliseconds);
  }
}
