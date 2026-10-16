/**
 * A lane of a game preview's plan (ADR-0104): one stream that holds an
 * emitter's voices of one bus one at a time, silence between them, to the
 * plan's end.
 *
 * A voice is a segment reading its own stream from its first frame, through
 * its stages (its layout made stereo, its gain); a voice stolen or stopped is
 * that segment to the frame it was cut and a second, reading on from there,
 * through a fade to silence over the fade's frames. So a voice cut later in a
 * continued plan changes only where its first segment ends and what follows,
 * never a segment before: the lane reads the same as far as the plan it
 * continues was decided.
 *
 * A lane that has played for long forgets what came before a frame
 * ({@link forgottenLane}): its segments before the voice or silence that plays
 * across that frame become one of silence as long as they were, so its frames
 * keep their places and the lane holds what is still to be heard.
 */

import {
  FadeShape,
  derivedSampleCount,
  type PlanSegment,
  type PlanSource,
  type PlanStage,
} from '@audiogubbins/domain';

/** One voice in a lane. */
export interface Placement {
  readonly voice: number;
  readonly start: number;
  /** Where the voice stops being whole: cut, played to its end, or the plan's end. */
  readonly bodyEnd: number;
  /** Where its sound ends, its fade included; `bodyEnd` where it is not cut. */
  readonly soundEnd: number;
  /** The stream the lane reads it from. */
  readonly heard: number;
  /** What it passes through: its layout made stereo, its gain. */
  readonly stages: readonly PlanStage[];
  /** The frames a fade takes in full, of which it may sound fewer. */
  readonly fade: number;
}

/** A lane's segments, where each ends, and the voice each is of (−1 for silence). */
export interface Lane {
  readonly segments: readonly PlanSegment[];
  readonly ends: readonly number[];
  readonly owners: readonly number[];
  /** In order of start. */
  readonly placements: readonly Placement[];
  /** The frames at its start it no longer describes, silence in their place; 0 where none. */
  readonly forgotten: number;
}

const SILENCE: PlanSource = { kind: 'silence', channels: 2 };

function segment(
  source: PlanSource,
  start: number,
  length: number,
  stages: readonly PlanStage[],
): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages,
  };
}

/** A lane of silence to `end`. */
export function emptyLane(end: number): Lane {
  return {
    segments: [segment(SILENCE, 0, end, [])],
    ends: [end],
    owners: [-1],
    placements: [],
    forgotten: 0,
  };
}

/** The first index of `count` items, whose `valueAt` rises, at which it is above (or at, `inclusive`) `frame`. */
function firstAbove(
  count: number,
  valueAt: (index: number) => number,
  frame: number,
  inclusive: boolean,
): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const value = valueAt(middle);
    if (inclusive ? value < frame : value <= frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The fade to silence a cut voice's second segment passes through, from content frame `from`. */
function fadeOut(from: number, length: number): PlanStage {
  return {
    kind: 'gain',
    from,
    to: from + length,
    gain: { kind: 'fade', origin: from, step: 1, length, shape: FadeShape.Linear, rising: false },
  };
}

/** The segments of one voice: whole to where it is cut, then fading, either of none frames left out. */
function placementSegments(placement: Placement): readonly PlanSegment[] {
  const source: PlanSource = { kind: 'stream', stream: placement.heard };
  const body = placement.bodyEnd - placement.start;
  const made: PlanSegment[] = [];
  // A voice cut on the frame it started is heard only fading.
  if (body > 0) made.push(segment(source, 0, body, placement.stages));
  if (placement.soundEnd > placement.bodyEnd) {
    made.push(
      segment(source, body, placement.soundEnd - placement.bodyEnd, [
        ...placement.stages,
        fadeOut(body, placement.fade),
      ]),
    );
  }
  return made;
}

/**
 * `lane` with its placements from `frame` on replaced by `placements` (each
 * starting at or after `frame`, or the voice sounding across it) and its end
 * at `end`: every segment that ends by the voice or silence across `frame`
 * kept as it is, and the rest made again.
 */
export function relaidLane(
  lane: Lane,
  frame: number,
  placements: readonly Placement[],
  end: number,
): Lane {
  const endAt = (index: number): number => lane.ends[index] ?? 0;
  let kept = Math.min(firstAbove(lane.ends.length, endAt, frame, false), lane.segments.length - 1);
  const owner = lane.owners[kept] ?? -1;
  while (kept > 0 && owner >= 0 && lane.owners[kept - 1] === owner) kept -= 1;
  const segments = lane.segments.slice(0, kept);
  const ends = lane.ends.slice(0, kept);
  const owners = lane.owners.slice(0, kept);
  const from = ends.at(-1) ?? 0;
  let position = from;
  const add = (made: PlanSegment, voice: number): void => {
    segments.push(made);
    position += made.length;
    ends.push(position);
    owners.push(voice);
  };
  const startAt = (index: number): number => lane.placements[index]?.start ?? 0;
  const before = lane.placements.slice(0, firstAbove(lane.placements.length, startAt, from, true));
  for (const placement of placements) {
    if (placement.start < position) continue;
    if (placement.start > position) add(segment(SILENCE, 0, placement.start - position, []), -1);
    for (const made of placementSegments(placement)) add(made, placement.voice);
  }
  if (position < end) add(segment(SILENCE, 0, end - position, []), -1);
  return {
    segments,
    ends,
    owners,
    placements: [...before, ...placements.filter((one) => one.start >= from)],
    forgotten: lane.forgotten,
  };
}

/**
 * `lane` with every segment that ends by the start of the voice or silence
 * playing across `frame` forgotten: one segment of silence as long in their
 * place, and the placements that sounded within it dropped. A voice playing
 * across `frame` keeps every segment, so a continuation from `frame` on lays
 * it as before.
 */
export function forgottenLane(lane: Lane, frame: number): Lane {
  let kept = firstAbove(lane.ends.length, (index) => lane.ends[index] ?? 0, frame, false);
  const owner = lane.owners[kept] ?? -1;
  while (kept > 0 && owner >= 0 && lane.owners[kept - 1] === owner) kept -= 1;
  const forgotten = kept === 0 ? 0 : (lane.ends[kept - 1] ?? 0);
  if (forgotten <= lane.forgotten) return lane;
  return {
    segments: [segment(SILENCE, 0, forgotten, []), ...lane.segments.slice(kept)],
    ends: [forgotten, ...lane.ends.slice(kept)],
    owners: [-1, ...lane.owners.slice(kept)],
    placements: lane.placements.filter((placement) => placement.soundEnd > forgotten),
    forgotten,
  };
}
