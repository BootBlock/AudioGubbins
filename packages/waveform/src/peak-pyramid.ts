/**
 * A source's peaks at every level, filled in as the worker finishes them.
 *
 * The page holds one pyramid per source identity and revision, shared by every
 * view that shows it (ADR-0043). It starts empty and each finished run of
 * buckets is copied in as it arrives, so a view draws what is known and marks
 * the rest as pending; `version` counts the runs applied, so a view redraws
 * when it has moved and not otherwise. It is derived data: losing it loses
 * nothing but the time to make it again.
 */

import type { LevelGeometry, PeakGeometry } from './peak-geometry.js';

/** One channel's buckets at one level, in the steps of `quantisation.ts`. */
export interface PeakChannel {
  readonly minimum: Int16Array;
  readonly maximum: Int16Array;
  readonly rms: Int16Array;
  /** One byte a bucket: 1 where a sample reached full scale or was not finite. */
  readonly clipped: Uint8Array;
}

/** One level's buckets for every channel, and which of them are known. */
export interface PeakLevel extends LevelGeometry {
  readonly channels: readonly PeakChannel[];
  /** One byte a bucket: 1 once every channel's bucket is filled. */
  readonly known: Uint8Array;
}

/** A finished run of buckets at one level, as the worker sends it. */
export interface PeakRun {
  readonly level: number;
  readonly first: number;
  /** Each channel's values for the run's buckets, all of one length. */
  readonly channels: readonly PeakChannel[];
}

/**
 * `channels` channels of `buckets` buckets each, all views of one buffer, so a
 * message carrying them transfers one buffer rather than four a channel. The
 * 16-bit arrays come first, so each starts on a whole number of their values.
 */
export function packedChannels(channels: number, buckets: number): PeakChannel[] {
  const wide = Int16Array.BYTES_PER_ELEMENT * buckets;
  const buffer = new ArrayBuffer(channels * (3 * wide + buckets));
  const bytes = channels * 3 * wide;
  return Array.from({ length: channels }, (_, channel) => ({
    minimum: new Int16Array(buffer, (channel * 3 + 0) * wide, buckets),
    maximum: new Int16Array(buffer, (channel * 3 + 1) * wide, buckets),
    rms: new Int16Array(buffer, (channel * 3 + 2) * wide, buckets),
    clipped: new Uint8Array(buffer, bytes + channel * buckets, buckets),
  }));
}

/** Copies `count` buckets of `from` from bucket `first` into `into` from bucket `at`. */
export function copyBuckets(
  from: PeakChannel,
  first: number,
  count: number,
  into: PeakChannel,
  at: number,
): void {
  into.minimum.set(from.minimum.subarray(first, first + count), at);
  into.maximum.set(from.maximum.subarray(first, first + count), at);
  into.rms.set(from.rms.subarray(first, first + count), at);
  into.clipped.set(from.clipped.subarray(first, first + count), at);
}

/** A pyramid's levels, empty, for a source of `geometry`. */
export function emptyLevels(geometry: PeakGeometry): readonly PeakLevel[] {
  return geometry.levels.map((level) => ({
    ...level,
    channels: packedChannels(geometry.channels, level.buckets),
    known: new Uint8Array(level.buckets),
  }));
}

/** A source's peaks at every level. */
export class WaveformPeakPyramid {
  readonly geometry: PeakGeometry;
  readonly levels: readonly PeakLevel[];
  #version = 0;
  /** How many buckets of each level are known. */
  readonly #known: number[];

  /**
   * A pyramid over `levels`, which a cache that was read whole gives already
   * known, or an empty one to fill.
   */
  constructor(geometry: PeakGeometry, levels: readonly PeakLevel[] = emptyLevels(geometry)) {
    this.geometry = geometry;
    this.levels = levels;
    this.#known = levels.map((level) => level.known.reduce((sum, one) => sum + one, 0));
  }

  /** How many runs have been applied, so a reader can tell whether it has moved. */
  get version(): number {
    return this.#version;
  }

  /** The share of level zero known, from 0 to 1; 1 for a source of no frames. */
  get progress(): number {
    const buckets = this.levels[0]?.buckets ?? 0;
    return buckets === 0 ? 1 : (this.#known[0] ?? 0) / buckets;
  }

  /** Whether every bucket of every level is known. */
  get complete(): boolean {
    return this.levels.every((level, index) => this.#known[index] === level.buckets);
  }

  /** Copies a finished run in. A run outside the pyramid's shape is a fault of its sender. */
  apply(run: PeakRun): void {
    const level = this.levels[run.level];
    const count = run.channels[0]?.minimum.length ?? 0;
    if (level === undefined || run.first < 0 || run.first + count > level.buckets) {
      throw new RangeError(
        `A run of ${String(count)} at ${String(run.first)} does not fit level ${String(run.level)}.`,
      );
    }
    if (run.channels.length !== level.channels.length) {
      throw new RangeError(
        `A run of ${String(run.channels.length)} channels does not fit ${String(level.channels.length)}.`,
      );
    }
    run.channels.forEach((values, index) => {
      const into = level.channels[index];
      if (into !== undefined) copyBuckets(values, 0, count, into, run.first);
    });
    let newlyKnown = 0;
    for (let bucket = run.first; bucket < run.first + count; bucket += 1) {
      if (level.known[bucket] === 0) newlyKnown += 1;
    }
    this.#known[run.level] = (this.#known[run.level] ?? 0) + newlyKnown;
    level.known.fill(1, run.first, run.first + count);
    this.#version += 1;
  }
}
