/**
 * A feed destination that says when the first of a run's audio has reached
 * it, so playback starts only once there is something to play.
 *
 * A source reads asynchronously, and the audio thread may start the moment
 * it is told to, so a `start` sent with the feeds still empty is an underrun
 * at the first quantum, every time, and a certain one where a source reads
 * from storage. Everything else it passes to the destination it wraps.
 */

import type { AudioFrameBlock } from '@audiogubbins/audio-engine';

import type { FeedDestination } from '../feed/feed-pump.js';

/** A destination whose `primed` settles at its first delivery or its end, whichever is first. */
export class PrimingDestination implements FeedDestination {
  readonly primed: Promise<void>;
  readonly #inner: FeedDestination;
  #resolve: () => void = () => undefined;

  constructor(inner: FeedDestination) {
    this.#inner = inner;
    this.primed = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
  }

  get queued(): number {
    return this.#inner.queued;
  }

  get room(): number {
    return this.#inner.room;
  }

  get blockLimit(): number | undefined {
    return this.#inner.blockLimit;
  }

  blockFor(frames: number): AudioFrameBlock {
    return this.#inner.blockFor(frames);
  }

  deliver(block: AudioFrameBlock): number {
    const taken = this.#inner.deliver(block);
    this.#resolve();
    return taken;
  }

  /** A source with nothing left from the start is primed by its end, which the processor hears. */
  end(): void {
    this.#inner.end();
    this.#resolve();
  }

  consumed(frames: number): void {
    this.#inner.consumed(frames);
  }
}
