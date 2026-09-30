/**
 * The peaks of each column a view draws, read from the pyramid or, where a
 * column is narrower than a level-zero bucket, from a window of detail buckets
 * or of the samples themselves (ADR-0043).
 *
 * A column covers the frames from its left edge to the next column's, so
 * adjacent columns share no frame and miss none. From the pyramid it takes the
 * coarsest level no wider than a column and combines the buckets the column
 * touches, so a transient is drawn in the column it falls in or its neighbour,
 * never lost between them. A column is known only when every bucket it reads
 * is; an unknown one is drawn as pending. A window is read over the pyramid's
 * columns, replacing those it holds whole, so a view scrolled past its window
 * draws level zero's coarser envelope until the next window arrives, and no
 * column reads more than sixteen buckets or samples. The arrays are reused from
 * call to call (G4): a view reads into the same columns each frame.
 */

import { levelFor } from './peak-geometry.js';
import type { PeakChannel, WaveformPeakPyramid } from './peak-pyramid.js';
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
 * The buckets a column reads: `values` from bucket `offset` of a run that
 * starts at frame `origin`, each `bucketFrames` wide, of which `known` says
 * which are filled (every one, where it is `undefined`). Frames before `origin`
 * or past the run's end are not in it.
 */
interface BucketRun {
  readonly values: PeakChannel;
  readonly known: Uint8Array | undefined;
  readonly origin: number;
  readonly bucketFrames: number;
  readonly buckets: number;
  /** The frames the run holds, which its last bucket may hold fewer of. */
  readonly frames: number;
}

/**
 * Reads the columns of `span` that `run` holds into `into`, each the envelope
 * of the buckets it touches, and leaves the columns it does not hold as they
 * were, so a finer run can be read over a coarser one. A window holds a column
 * only whole (`whole`); the pyramid holds the last column of the source too,
 * which runs past its end.
 */
function readRun(run: BucketRun, span: ColumnSpan, into: ColumnPeaks, whole: boolean): void {
  const { values, known, origin, bucketFrames } = run;
  for (let column = 0; column < into.columns; column += 1) {
    const [from, to] = columnFrames(span, column);
    const end = origin + run.frames;
    if (to <= from || from < origin || from >= end || (whole && to > end)) continue;
    const first = Math.floor((from - origin) / bucketFrames);
    const last = Math.min(run.buckets - 1, Math.ceil((to - origin) / bucketFrames) - 1);
    let low = Infinity;
    let high = -Infinity;
    let squares = 0;
    let clipped = 0;
    let filled = 1;
    for (let bucket = first; bucket <= last; bucket += 1) {
      filled &= known === undefined ? 1 : (known[bucket] ?? 0);
      low = Math.min(low, values.minimum[bucket] ?? 0);
      high = Math.max(high, values.maximum[bucket] ?? 0);
      const rms = fromSteps(values.rms[bucket] ?? 0);
      squares += rms * rms;
      clipped |= values.clipped[bucket] ?? 0;
    }
    const count = last - first + 1;
    if (count <= 0 || filled === 0) continue;
    into.known[column] = 1;
    into.minimum[column] = fromSteps(low);
    into.maximum[column] = fromSteps(high);
    into.rms[column] = Math.sqrt(squares / count);
    into.clipped[column] = clipped;
  }
}

/**
 * Fills `into` with channel `channel`'s peaks over `span`, read from the
 * pyramid: every column is read, as pending where a bucket it touches is not
 * yet known. A column narrower than a level-zero bucket reads the bucket it
 * falls in, which a finer window read after it replaces.
 */
export function readPyramidColumns(
  pyramid: WaveformPeakPyramid,
  channel: number,
  span: ColumnSpan,
  into: ColumnPeaks,
): void {
  into.columns = Math.min(span.columns, into.minimum.length);
  into.known.fill(0, 0, into.columns);
  const level = pyramid.levels[levelFor(pyramid.geometry, span.framesPerColumn)];
  const values = level?.channels[channel];
  if (level === undefined || values === undefined) return;
  readRun(
    {
      values,
      known: level.known,
      origin: 0,
      bucketFrames: level.bucketFrames,
      buckets: level.buckets,
      frames: pyramid.geometry.frames,
    },
    span,
    into,
    false,
  );
}

/**
 * A window of detail buckets for every channel from frame `start`, as a view
 * reads them where a column is narrower than a level-zero bucket.
 */
export interface BucketWindow {
  readonly start: number;
  /** The frames the window holds, which its last bucket may hold fewer of. */
  readonly frames: number;
  readonly bucketFrames: number;
  readonly channels: readonly PeakChannel[];
}

/**
 * Reads channel `channel`'s peaks over the columns of `span` that `held` covers
 * whole into `into`, over what was read before; the columns `held` does not
 * cover keep what they had.
 */
export function readBucketColumns(
  held: BucketWindow,
  channel: number,
  span: ColumnSpan,
  into: ColumnPeaks,
): void {
  const values = held.channels[channel];
  if (values === undefined) return;
  readRun(
    {
      values,
      known: undefined,
      origin: held.start,
      bucketFrames: held.bucketFrames,
      buckets: values.minimum.length,
      frames: held.frames,
    },
    span,
    into,
    true,
  );
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

/**
 * Reads channel `channel`'s peaks over the columns of `span` that `held` covers
 * whole into `into`, from its samples, over what was read before; the columns
 * `held` does not cover keep what they had.
 */
export function readSampleColumns(
  held: SampleWindow,
  channel: number,
  span: ColumnSpan,
  into: ColumnPeaks,
): void {
  const samples = held.channels[channel];
  if (samples === undefined) return;
  const heldEnd = held.start + windowFrames(held);
  for (let column = 0; column < into.columns; column += 1) {
    const [from, to] = columnFrames(span, column);
    const first = from;
    const end = Math.max(to, from + 1);
    if (first < held.start || end > heldEnd) continue;
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
