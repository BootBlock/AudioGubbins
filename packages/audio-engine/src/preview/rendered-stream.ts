/**
 * One processed stream's render, read while it is being made.
 *
 * The render is made in order from the stream's first frame, so what is made
 * is always one run of frames from the start, and how far it has reached is
 * all a reader needs to know. A read within that is answered at once; a read
 * past it waits until the render reaches its end, so a reader never hears
 * silence for audio not yet made; and a read of a render that failed, or was
 * given up, fails with the reason. Its memory is counted whole from the start,
 * since the cache that keeps it counts it at that size, and taken only once
 * the render begins, so a render the cache declines never takes any.
 */

import {
  FailureKind,
  cancellationReason,
  failure,
  type CancellationSignal,
  type DomainFailure,
} from '@audiogubbins/domain';

import { MediaReadFailure } from '../pcm/plan-content.js';

/** How far a render has come. */
export const RenderPhase = {
  /** Waiting for a place among the renders being made. */
  Queued: 'queued',
  /** Being made: measuring its whole passes, then rendering frame by frame. */
  Making: 'making',
  Made: 'made',
  Failed: 'failed',
} as const;

/** How far a render has come. */
export type RenderPhase = (typeof RenderPhase)[keyof typeof RenderPhase];

/** A read waiting for the render to reach its end. */
interface Waiting {
  readonly end: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/** The failure of a read of a render that was given up before it was made. */
export const RENDER_GIVEN_UP = failure(
  'preview.render-given-up',
  FailureKind.Retryable,
  'The preview was given up before it was made, as nothing was listening to it.',
);

/** A render of one stream, in memory, readable as far as it has reached. */
export class RenderedStream {
  readonly length: number;
  readonly channels: number;
  /** Its samples, one array per channel, once it has begun. */
  #samples: readonly Float32Array[] = [];
  readonly #waiting = new Set<Waiting>();
  #reached = 0;
  #phase: RenderPhase = RenderPhase.Queued;
  #failure: DomainFailure | undefined;

  constructor(channels: number, length: number) {
    this.length = length;
    this.channels = channels;
  }

  /** Bytes its samples take, all of them from the start. */
  get bytes(): number {
    return this.channels * this.length * Float32Array.BYTES_PER_ELEMENT;
  }

  /** Frames made so far, from the stream's first. */
  get reached(): number {
    return this.#reached;
  }

  get phase(): RenderPhase {
    return this.#phase;
  }

  /** Why it failed, where it did. */
  get failure(): DomainFailure | undefined {
    return this.#failure;
  }

  /** Marks it as being made, and takes the memory its samples need. */
  begin(): void {
    if (this.#phase !== RenderPhase.Queued) return;
    this.#phase = RenderPhase.Making;
    this.#samples = Array.from({ length: this.channels }, () => new Float32Array(this.length));
  }

  /** Appends `frames` frames, one array per channel, after those made so far. */
  append(channels: readonly Float32Array[], frames: number): void {
    const count = Math.min(frames, this.length - this.#reached);
    this.#samples.forEach((channel, index) => {
      const from = channels[index];
      if (from !== undefined) channel.set(from.subarray(0, count), this.#reached);
    });
    this.#reached += count;
    if (this.#reached === this.length) this.#phase = RenderPhase.Made;
    this.#wake();
  }

  /** Ends it with `problem`: every read waiting, and every read after, fails with it. */
  fail(problem: DomainFailure): void {
    if (this.#phase === RenderPhase.Made || this.#phase === RenderPhase.Failed) return;
    this.#phase = RenderPhase.Failed;
    this.#failure = problem;
    // Nothing more is read of it, and the cache no longer counts it.
    this.#samples = [];
    this.#wake();
  }

  /**
   * Copies frames `start` to `start + frames` into `into`, once the render
   * has reached them, or fails with its reason, or the signal's.
   */
  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    const end = Math.min(start + frames, this.length);
    await this.#reachedTo(end, signal);
    this.#samples.forEach((channel, index) => {
      into[index]?.set(channel.subarray(start, end));
    });
  }

  /** Settles once the render has reached `end`, or fails as {@link read} does. */
  #reachedTo(end: number, signal: CancellationSignal | undefined): Promise<void> {
    if (this.#failure !== undefined) return Promise.reject(new MediaReadFailure(this.#failure));
    if (end <= this.#reached) return Promise.resolve();
    if (signal?.aborted === true) return Promise.reject(cancellationReason(signal));
    return new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        this.#waiting.delete(waiting);
        if (signal !== undefined) reject(cancellationReason(signal));
      };
      const waiting: Waiting = {
        end,
        resolve: () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      };
      this.#waiting.add(waiting);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  /** Answers every read the render has now reached, or fails them all where it failed. */
  #wake(): void {
    for (const waiting of [...this.#waiting]) {
      if (this.#failure !== undefined) {
        this.#waiting.delete(waiting);
        waiting.reject(new MediaReadFailure(this.#failure));
      } else if (waiting.end <= this.#reached) {
        this.#waiting.delete(waiting);
        waiting.resolve();
      }
    }
  }
}
