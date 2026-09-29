/**
 * Summarising a source's chunks into a pyramid, in any order.
 *
 * The worker hands each chunk it reads to the builder, nearest first to what a
 * view shows, so chunks arrive out of order. A chunk fills its level-zero
 * buckets; a bucket above is finished the moment the last of its four below is,
 * so what a view shows fills in at every level as soon as it can. Each call
 * answers the runs it finished, for the worker to send to the page.
 *
 * The root mean square of a bucket above is taken from the mean squares of the
 * buckets below, kept in full precision here, weighted by the frames each
 * holds, so a short last bucket does not count for a full one.
 */

import type { AudioFrameBlock } from '@audiogubbins/audio-engine';

import {
  BASE_BUCKET_FRAMES,
  CHUNK_FRAMES,
  LEVEL_FANOUT,
  framesInBucket,
  type PeakGeometry,
} from './peak-geometry.js';
import {
  copyBuckets,
  emptyLevels,
  packedChannels,
  type PeakLevel,
  type PeakRun,
} from './peak-pyramid.js';
import { summariseBucket } from './bucket-summary.js';
import { rmsStep } from './quantisation.js';

/** A run of buckets finished at one level, `[first, end)`. */
interface Finished {
  readonly level: number;
  readonly first: number;
  readonly end: number;
}

/** Builds a pyramid from its chunks. */
export class PeakBuilder {
  readonly geometry: PeakGeometry;
  /** The pyramid as it is built, which the worker encodes once every chunk is in. */
  readonly levels: readonly PeakLevel[];
  /** Each level's mean square per channel, in full precision, for the level above. */
  readonly #meanSquares: readonly (readonly Float64Array[])[];

  constructor(geometry: PeakGeometry) {
    this.geometry = geometry;
    this.levels = emptyLevels(geometry);
    this.#meanSquares = geometry.levels.map((level) =>
      Array.from({ length: geometry.channels }, () => new Float64Array(level.buckets)),
    );
  }

  /**
   * Summarises chunk `chunk`, whose frames are the first `frames` of `block`,
   * and answers every run it finished, level zero first.
   */
  addChunk(chunk: number, block: AudioFrameBlock, frames: number): readonly PeakRun[] {
    const first = (chunk * CHUNK_FRAMES) / BASE_BUCKET_FRAMES;
    const end = first + Math.ceil(frames / BASE_BUCKET_FRAMES);
    this.#fillBase(block, first, end);
    const finished: Finished[] = [{ level: 0, first, end }];
    let below = finished[0];
    for (let level = 1; below !== undefined && level < this.levels.length; level += 1) {
      below = this.#fillAbove(level, below);
      if (below !== undefined) finished.push(below);
    }
    return finished.map((run) => this.#runOf(run));
  }

  #fillBase(block: AudioFrameBlock, first: number, end: number): void {
    const level = this.levels[0];
    if (level === undefined) return;
    const geometry = this.geometry;
    block.channels.forEach((samples, channel) => {
      const into = level.channels[channel];
      const squares = this.#meanSquares[0]?.[channel];
      if (into === undefined || squares === undefined) return;
      for (let bucket = first; bucket < end; bucket += 1) {
        const offset = (bucket - first) * BASE_BUCKET_FRAMES;
        const count = framesInBucket(geometry, level, bucket);
        squares[bucket] = summariseBucket(samples, offset, count, into, bucket);
      }
    });
    level.known.fill(1, first, end);
  }

  /** Finishes the buckets of `level` above the run `below` whose children are all known. */
  #fillAbove(level: number, below: Finished): Finished | undefined {
    const parent = this.levels[level];
    const child = this.levels[level - 1];
    if (parent === undefined || child === undefined) return undefined;
    let first: number | undefined;
    let end = 0;
    const from = Math.floor(below.first / LEVEL_FANOUT);
    const to = Math.floor((below.end - 1) / LEVEL_FANOUT);
    for (let bucket = from; bucket <= to; bucket += 1) {
      const start = bucket * LEVEL_FANOUT;
      const stop = Math.min(start + LEVEL_FANOUT, child.buckets);
      if (
        parent.known[bucket] === 1 ||
        !child.known.subarray(start, stop).every((one) => one === 1)
      ) {
        continue;
      }
      this.#combine(level, bucket, start, stop);
      parent.known[bucket] = 1;
      first ??= bucket;
      end = bucket + 1;
    }
    // Finished buckets of one run are contiguous: a gap would be a bucket whose
    // children the run completed on both sides of and not within.
    return first === undefined ? undefined : { level, first, end };
  }

  #combine(level: number, bucket: number, start: number, stop: number): void {
    const geometry = this.geometry;
    const parent = this.levels[level];
    const child = this.levels[level - 1];
    if (parent === undefined || child === undefined) return;
    parent.channels.forEach((into, channel) => {
      const from = child.channels[channel];
      const childSquares = this.#meanSquares[level - 1]?.[channel];
      const squares = this.#meanSquares[level]?.[channel];
      if (from === undefined || childSquares === undefined || squares === undefined) return;
      let low = Infinity;
      let high = -Infinity;
      let weighted = 0;
      let frames = 0;
      let clipped = 0;
      for (let index = start; index < stop; index += 1) {
        const count = framesInBucket(geometry, child, index);
        low = Math.min(low, from.minimum[index] ?? 0);
        high = Math.max(high, from.maximum[index] ?? 0);
        weighted += (childSquares[index] ?? 0) * count;
        frames += count;
        clipped |= from.clipped[index] ?? 0;
      }
      const meanSquare = frames > 0 ? weighted / frames : 0;
      squares[bucket] = meanSquare;
      into.minimum[bucket] = low;
      into.maximum[bucket] = high;
      into.rms[bucket] = rmsStep(Math.sqrt(meanSquare));
      into.clipped[bucket] = clipped;
    });
  }

  /** A run's values, copied out so the builder's arrays are never transferred away. */
  #runOf(finished: Finished): PeakRun {
    const level = this.levels[finished.level];
    const count = finished.end - finished.first;
    const channels = packedChannels(level?.channels.length ?? 0, count);
    level?.channels.forEach((from, index) => {
      const into = channels[index];
      if (into !== undefined) copyBuckets(from, finished.first, count, into, 0);
    });
    return { level: finished.level, first: finished.first, channels };
  }
}
