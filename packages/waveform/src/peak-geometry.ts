/**
 * The shape of a peak pyramid: how many buckets each level has, and how many
 * frames each bucket summarises (ADR-0043).
 *
 * Level zero summarises 256 frames a bucket, and each level above it four
 * buckets of the one below, up to the level whose one bucket holds every frame.
 * A view picks the coarsest level whose buckets are no wider than one of its
 * columns, so a column never combines more than four buckets of it, and the
 * whole of a three-hour file is drawn from a few thousand values. The source is
 * read in chunks of 65,536 frames, 256 buckets of level zero, each finished as
 * a whole.
 */

/** Frames a bucket of level zero summarises. */
export const BASE_BUCKET_FRAMES = 256;

/** Buckets of a level that one bucket of the level above summarises. */
export const LEVEL_FANOUT = 4;

/** Frames the source is read in at a time, a whole number of level-zero buckets. */
export const CHUNK_FRAMES = 65_536;

/**
 * Frames a bucket of a detail window summarises: where a device column is
 * narrower than a level-zero bucket and no narrower than this, a view reads a
 * window of these buckets, so no column combines more than sixteen of them and
 * none reads raw samples.
 */
export const DETAIL_BUCKET_FRAMES = 16;

/**
 * The widest view, in device columns, a window is sized for: past the widest
 * canvas a browser draws. A view wider still is drawn where its window reaches
 * and marked pending beyond, and never asks again for a window it holds.
 */
const WIDEST_VIEW_COLUMNS = 16_384;

/** The spans of a view a window holds: the view's own, and one either side. */
export const WINDOW_SPANS = 3;

/** How a view reads the peaks of its columns, from the finest detail to the coarsest. */
export const DetailKind = {
  /** Each column holds fewer frames than a detail bucket: the samples themselves. */
  Samples: 'samples',
  /** Each column holds fewer frames than a level-zero bucket: a window of detail buckets. */
  Buckets: 'buckets',
  /** Each column holds a level-zero bucket or more: the pyramid. */
  Pyramid: 'pyramid',
} as const;

export type DetailKind = (typeof DetailKind)[keyof typeof DetailKind];

/** How a column of `framesPerColumn` frames is read. */
export function detailFor(framesPerColumn: number): DetailKind {
  if (framesPerColumn >= BASE_BUCKET_FRAMES) return DetailKind.Pyramid;
  return framesPerColumn >= DETAIL_BUCKET_FRAMES ? DetailKind.Buckets : DetailKind.Samples;
}

/**
 * The most frames a window of `kind` holds: the spans of the widest view at the
 * coarsest zoom that reads it, so a window always covers what a view shows, and
 * the worker answers no larger request.
 */
export function largestWindow(kind: typeof DetailKind.Samples | typeof DetailKind.Buckets): number {
  const framesPerColumn = kind === DetailKind.Samples ? DETAIL_BUCKET_FRAMES : BASE_BUCKET_FRAMES;
  return WINDOW_SPANS * framesPerColumn * WIDEST_VIEW_COLUMNS;
}

/** One level's buckets. */
export interface LevelGeometry {
  /** Frames each bucket summarises; the last bucket may hold fewer. */
  readonly bucketFrames: number;
  readonly buckets: number;
}

/** The shape of a source's pyramid. */
export interface PeakGeometry {
  readonly frames: number;
  readonly channels: number;
  /** Level zero first. */
  readonly levels: readonly LevelGeometry[];
}

/** The pyramid of a source of `frames` frames and `channels` channels. */
export function peakGeometry(frames: number, channels: number): PeakGeometry {
  const levels: LevelGeometry[] = [];
  let bucketFrames = BASE_BUCKET_FRAMES;
  for (;;) {
    const buckets = Math.ceil(frames / bucketFrames);
    levels.push({ bucketFrames, buckets });
    if (buckets <= 1) break;
    bucketFrames *= LEVEL_FANOUT;
  }
  return { frames, channels, levels };
}

/** How many chunks the source is read in. */
export function chunkCount(geometry: PeakGeometry): number {
  return Math.ceil(geometry.frames / CHUNK_FRAMES);
}

/** The frames bucket `index` of a level summarises: its width, or what is left at the end. */
export function framesInBucket(
  geometry: PeakGeometry,
  level: LevelGeometry,
  index: number,
): number {
  return Math.max(0, Math.min(level.bucketFrames, geometry.frames - index * level.bucketFrames));
}

/**
 * The coarsest level whose buckets are no wider than `framesPerColumn`, or
 * level zero where a column is narrower than one of its buckets: finer detail
 * is a window's, and level zero is what is drawn until the window arrives.
 */
export function levelFor(geometry: PeakGeometry, framesPerColumn: number): number {
  let chosen = 0;
  geometry.levels.forEach((level, index) => {
    if (level.bucketFrames <= framesPerColumn) chosen = index;
  });
  return chosen;
}
