/**
 * The peaks of each column a view draws, read from the pyramid or, where a
 * column is narrower than a level-zero bucket, from the samples themselves.
 *
 * A column covers the frames from its left edge to the next column's, so
 * adjacent columns share no frame and miss none. From the pyramid it takes the
 * coarsest level no wider than a column and combines the buckets the column
 * touches, so a transient is drawn in the column it falls in or its neighbour,
 * never lost between them. A column is known only when every bucket it reads
 * is; an unknown one is drawn as pending. The arrays are reused from call to
 * call (G4): a view reads into the same columns each frame.
 */

import { levelFor } from './peak-geometry.js';
import type { WaveformPeakPyramid } from './peak-pyramid.js';
import { fromSteps } from './quantisation.js';

/** One channel's peaks per column, in full scale. */
export interface ColumnPeaks {
  /** How many columns the last read filled. */
  columns: number;
  readonly minimum: Float32Array;
  readonly maximum: Float32Array;
  readonly rms: Float32Array;
  /** 1 where a sample in the column reached full scale or was not finite. */
  readonly clipped: Uint8Array;
  /** 1 where every bucket the column reads is known. */
  readonly known: Uint8Array;
}

/** Columns for up to `capacity` columns, to read into again and again. */
export function columnPeaks(capacity: number): ColumnPeaks {
  return {
    columns: 0,
    minimum: new Float32Array(capacity),
    maximum: new Float32Array(capacity),
    rms: new Float32Array(capacity),
    clipped: new Uint8Array(capacity),
    known: new Uint8Array(capacity),
  };
}

/** Where the columns start and how wide each is, in frames, which may be fractions. */
export interface ColumnSpan {
  readonly start: number;
  readonly framesPerColumn: number;
  readonly columns: number;
}

function columnFrames(span: ColumnSpan, column: number): readonly [number, number] {
  return [
    Math.floor(span.start + column * span.framesPerColumn),
    Math.floor(span.start + (column + 1) * span.framesPerColumn),
  ];
}

/**
 * Whether `span` is read from the pyramid: a column is at least as wide as a
 * level-zero bucket.
 */
export function readsPyramid(pyramid: WaveformPeakPyramid, span: ColumnSpan): boolean {
  return levelFor(pyramid.geometry, span.framesPerColumn) !== undefined;
}

/** Fills `into` with channel `channel`'s peaks over `span`, read from the pyramid. */
export function readPyramidColumns(
  pyramid: WaveformPeakPyramid,
  channel: number,
  span: ColumnSpan,
  into: ColumnPeaks,
): void {
  const index = levelFor(pyramid.geometry, span.framesPerColumn);
  const level = index === undefined ? undefined : pyramid.levels[index];
  const values = level?.channels[channel];
  const columns = Math.min(span.columns, into.minimum.length);
  into.columns = columns;
  for (let column = 0; column < columns; column += 1) {
    const [from, to] = columnFrames(span, column);
    if (
      level === undefined ||
      values === undefined ||
      to <= from ||
      from >= pyramid.geometry.frames
    ) {
      into.known[column] = 0;
      continue;
    }
    const first = Math.max(0, Math.floor(from / level.bucketFrames));
    const last = Math.min(level.buckets - 1, Math.ceil(to / level.bucketFrames) - 1);
    let low = Infinity;
    let high = -Infinity;
    let squares = 0;
    let clipped = 0;
    let known = 1;
    for (let bucket = first; bucket <= last; bucket += 1) {
      known &= level.known[bucket] ?? 0;
      low = Math.min(low, values.minimum[bucket] ?? 0);
      high = Math.max(high, values.maximum[bucket] ?? 0);
      const rms = fromSteps(values.rms[bucket] ?? 0);
      squares += rms * rms;
      clipped |= values.clipped[bucket] ?? 0;
    }
    const count = last - first + 1;
    into.known[column] = count > 0 ? known : 0;
    into.minimum[column] = fromSteps(low === Infinity ? 0 : low);
    into.maximum[column] = fromSteps(high === -Infinity ? 0 : high);
    into.rms[column] = count > 0 ? Math.sqrt(squares / count) : 0;
    into.clipped[column] = clipped;
  }
}

/** Samples of every channel from `start`, as a view reads them where a sample is wider than a bucket. */
export interface SampleWindow {
  readonly start: number;
  readonly channels: readonly Float32Array[];
}

/** The frames a window holds. */
export function windowFrames(held: SampleWindow): number {
  return held.channels[0]?.length ?? 0;
}

/** Whether a window holds every frame of `span`. */
export function windowCovers(held: SampleWindow, span: ColumnSpan): boolean {
  const [from] = columnFrames(span, 0);
  const [, to] = columnFrames(span, span.columns - 1);
  return from >= held.start && to <= held.start + windowFrames(held);
}

/** Fills `into` with channel `channel`'s peaks over `span`, read from the samples of `held`. */
export function readSampleColumns(
  held: SampleWindow,
  channel: number,
  span: ColumnSpan,
  into: ColumnPeaks,
): void {
  const samples = held.channels[channel];
  const columns = Math.min(span.columns, into.minimum.length);
  into.columns = columns;
  for (let column = 0; column < columns; column += 1) {
    const [from, to] = columnFrames(span, column);
    const first = Math.max(from, held.start);
    const end = Math.min(Math.max(to, from + 1), held.start + windowFrames(held));
    if (samples === undefined || end <= first) {
      into.known[column] = 0;
      continue;
    }
    let low = Infinity;
    let high = -Infinity;
    let squares = 0;
    let clipped = 0;
    for (let frame = first; frame < end; frame += 1) {
      const sample = samples[frame - held.start] ?? 0;
      if (!Number.isFinite(sample)) {
        clipped = 1;
        continue;
      }
      low = Math.min(low, sample);
      high = Math.max(high, sample);
      squares += sample * sample;
      if (sample >= 1 || sample <= -1) clipped = 1;
    }
    into.known[column] = 1;
    into.minimum[column] = low === Infinity ? 0 : low;
    into.maximum[column] = high === -Infinity ? 0 : high;
    into.rms[column] = Math.sqrt(squares / (end - first));
    into.clipped[column] = clipped;
  }
}
