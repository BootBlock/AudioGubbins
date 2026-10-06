/**
 * How a model that hears a stream in runs of fixed length is run over a
 * stream of any length, and how the runs are joined (ADR-0062).
 *
 * A stream is cut into chunks of `chunk` frames, frames in whatever unit the
 * model counts in. Each run hears its chunk with the `warmUp` frames before
 * it, so whatever the model carries from frame to frame has settled by the
 * chunk's first frame, and only the chunk's own output is kept: the join is a
 * cut at the chunk's edge, the warm-up's output dropped. The first chunk has
 * nothing before it, and its run hears the frames after it in the warm-up's
 * place, so every run is one length, `chunk + warmUp`, and a model sees the
 * same shapes however long the stream is; a run that reaches past the end of
 * the stream hears silence there, which a model whose frames depend only on
 * those before them keeps out of the frames kept.
 *
 * The lengths are constants of each processor's implementation, never of the
 * stream, so a frame's output depends on where it is and what is around it,
 * not on how long the stream is: a render of a stream and of a longer one
 * agree over what they share.
 */

/** A fixed chunk length and warm-up, in a model's frames. */
export interface ChunkSchedule {
  readonly chunk: number;
  readonly warmUp: number;
}

/** One run of a schedule. */
export interface ScheduledRun {
  /** The first frame the run hears. */
  readonly first: number;
  /** The frames it hears, from `first`: always `chunk + warmUp`. */
  readonly length: number;
  /** The first frame whose output it keeps: `index · chunk`. */
  readonly kept: number;
  /** Where that frame is in the run: 0 for the first run, `warmUp` after. */
  readonly offset: number;
}

/**
 * Run `index` of `schedule`. A warm-up longer than a chunk would reach before
 * the stream for the second run, so it is a fault in the schedule.
 */
export function scheduledRun(schedule: ChunkSchedule, index: number): ScheduledRun {
  const { chunk, warmUp } = schedule;
  if (warmUp > chunk) throw new Error('A warm-up is no longer than the chunk it warms.');
  const kept = index * chunk;
  const first = index === 0 ? 0 : kept - warmUp;
  return { first, length: chunk + warmUp, kept, offset: kept - first };
}
