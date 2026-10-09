/**
 * A processed stream read from its render, or through its chain where the
 * cache declines to keep one (`cached-streams.ts`).
 *
 * The cache answers whether it keeps the render once it has weighed it, and
 * the first read waits for that answer: a render held is read as it is made;
 * one declined is read through the chain the reader runs itself, made only
 * then, so a stream read from its render never starts its chain.
 */

import type { CancellationSignal } from '@audiogubbins/domain';

import type { CachedStream } from './cached-streams.js';
import type { ContentReader } from './plan-content.js';

/** A stream read from its render, falling back to a run of its own. */
export class CachedContent implements ContentReader {
  readonly channels: number;
  readonly length: number;
  readonly #cached: CachedStream;
  readonly #own: () => ContentReader;
  #fallback: ContentReader | undefined;

  constructor(
    cached: CachedStream,
    shape: { readonly channels: number; readonly length: number },
    own: () => ContentReader,
  ) {
    this.#cached = cached;
    this.#own = own;
    this.channels = shape.channels;
    this.length = shape.length;
  }

  /** Whether the cache declined the render, so the reader runs the chain itself. */
  async #declined(): Promise<boolean> {
    return !(await this.#cached.ready).ok;
  }

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    if (!(await this.#declined())) {
      await this.#cached.read(start, frames, into, signal);
      return;
    }
    this.#fallback ??= this.#own();
    await this.#fallback.read(start, frames, into, signal);
  }

  release(): void {
    this.#cached.release();
    this.#fallback?.release();
    this.#fallback = undefined;
  }
}
