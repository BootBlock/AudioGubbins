/**
 * How a model that hears a stream in runs of fixed length is run over a
 * stream of any length, and how the runs are joined (ADR-0062).
 *
 * A stream is cut into chunks, frames in whatever unit the model counts in,
 * and each run keeps the output of one chunk alone: the join is a cut at the
 * chunk's edge, with nothing blended. A run hears `before` frames ahead of its
 * chunk, so whatever the model carries from frame to frame has settled, or
 * whatever it attends to is there, by the chunk's first frame, and `after`
 * frames past its chunk, for a model whose frames depend on what follows them
 * too. Every run hears `before + chunk + after` frames, so a model sees the
 * same shapes however long the stream is.
 *
 * The first run has nothing before it, so it hears the stream from its start
 * and keeps its first `firstChunk` frames: `chunk`, where a model needs a
 * warm-up and the first run hears the frames past its chunk only so that every
 * run is one length (DeepFilterNet 3); or as many as `chunk + before`, where a
 * frame's output needs context on both sides and the stream's start is context
 * enough, so the first run keeps all it hears short of its `after`
 * (MossFormer2). Each later chunk follows the one before it. A run that reaches
 * past the end of the stream hears silence there.
 *
 * The lengths are constants of each processor's implementation, never of the
 * stream, so a frame's output depends on where it is and what is around it,
 * not on how long the stream is: a render of a stream and of a longer one
 * agree over what they share.
 */

/** The fixed lengths of a schedule's runs, in a model's frames. */
export interface ChunkSchedule {
  /** The frames each run after the first keeps. */
  readonly chunk: number;
  /** The frames a run hears before those it keeps: its warm-up or context. */
  readonly before: number;
  /** The frames a run hears after those it keeps. */
  readonly after: number;
  /** The frames the first run keeps, from `max(chunk, before)` to `chunk + before`. */
  readonly firstChunk: number;
}

/** One run of a schedule. */
export interface ScheduledRun {
  /** The first frame the run hears. */
  readonly first: number;
  /** The frames it hears, from `first`: always `before + chunk + after`. */
  readonly length: number;
  /** The first frame whose output it keeps. */
  readonly kept: number;
  /** The frames whose output it keeps, from `kept`. */
  readonly keeps: number;
  /** Where `kept` is in the run: 0 for the first run, `before` after it. */
  readonly offset: number;
}

/**
 * Run `index` of `schedule`. A first chunk shorter than the context before
 * the second would have the second run reach before the stream, and one
 * longer than `chunk + before` would keep frames its run hears no `after`
 * for, so either is a fault in the schedule.
 */
export function scheduledRun(schedule: ChunkSchedule, index: number): ScheduledRun {
  const { chunk, before, after, firstChunk } = schedule;
  if (firstChunk < Math.max(chunk, before) || firstChunk > chunk + before) {
    throw new Error('A first chunk keeps from max(chunk, before) to chunk + before frames.');
  }
  const length = before + chunk + after;
  if (index === 0) return { first: 0, length, kept: 0, keeps: firstChunk, offset: 0 };
  const kept = firstChunk + (index - 1) * chunk;
  return { first: kept - before, length, kept, keeps: chunk, offset: before };
}
