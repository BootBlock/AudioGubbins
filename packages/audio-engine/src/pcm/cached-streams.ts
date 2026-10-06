/**
 * Where a processed stream's render is kept and read from (ADR-0060,
 * ADR-0061): the cached preview producer, as a reader of edited sound sees it.
 *
 * A chain that cannot run as it is heard, and every chain a reader hears from
 * the stream's start, is rendered once, from its own start, and read from
 * that render for as long as it is kept, so playback started twice measures a
 * whole pass once, and a waveform drawn out of order never starts the chain
 * again for a read behind the last. The reader names the stream by the plan
 * it is part of and the files the plan reads, and the cache by what decides
 * its sound (`cached-stream-key.ts`), so two readers of one sound share one
 * render however each came by its plan.
 *
 * The cache may decline a render, where it is longer than the cache can keep;
 * the reader then runs the chain itself, as it would with no cache at all, so
 * a declined render costs time and never the sound.
 */

import type {
  CancellationSignal,
  DomainResult,
  EditPlan,
  QualitySettings,
} from '@audiogubbins/domain';

import type { MediaEntry } from './plan-content.js';

/** A processed stream to read from a render: the stream of a plan, and the quality it runs at. */
export interface CachedStreamRequest {
  readonly plan: EditPlan;
  /** The place in the plan of the stream whose processed output is rendered. */
  readonly place: number;
  readonly media: readonly MediaEntry[];
  readonly quality: QualitySettings;
  /** Why playback hears a render of it rather than its chain, where it is playback that asks. */
  readonly reason?: string;
}

/** One reader's hold on a render: its frames as they are made. */
export interface CachedStream {
  /**
   * Settles once the cache holds the render or is making it, or with why it
   * will not, in which case the stream gives nothing and the reader runs the
   * chain itself.
   */
  readonly ready: Promise<DomainResult<void>>;

  /** Reads `frames` frames from `start` into `into`, once the render has made them. */
  read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void>;

  /** Lets the render go, which the cache may then give up. */
  release(): void;
}

/**
 * The renders a reader may read, for one purpose. A read past what is made so
 * far waits until it is made, and fails with the render's reason where the
 * render fails: it never answers silence for audio not yet made.
 */
export interface CachedStreams {
  open(request: CachedStreamRequest): CachedStream;
}
