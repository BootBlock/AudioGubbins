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
 * `undefined` where a column is narrower than a level-zero bucket and must be
 * drawn from the samples themselves.
 */
export function levelFor(geometry: PeakGeometry, framesPerColumn: number): number | undefined {
  let chosen: number | undefined;
  geometry.levels.forEach((level, index) => {
    if (level.bucketFrames <= framesPerColumn) chosen = index;
  });
  return chosen;
}
