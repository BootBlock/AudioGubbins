/**
 * Cutting, slicing and turning round a stream's segments, by positions in the
 * stream's own timeline.
 *
 * A segment keeps its stages in its content's frames (`plan.ts`), so every
 * operation here moves a segment's window on its content and never touches a
 * stage. A reversed segment plays its window from the end, so its first
 * output frame is its content's last.
 */

import { derivedSampleCount } from '../time/sample-time.js';
import type { PlanSegment } from './plan.js';

/**
 * The part of `segment` from output offset `offset`, `length` frames long.
 * A reversed segment's output runs from the end of its content, so the part
 * is taken from the other end of its window.
 */
export function sliceSegment(segment: PlanSegment, offset: number, length: number): PlanSegment {
  const start = segment.reversed
    ? segment.start + segment.length - offset - length
    : segment.start + offset;
  return { ...segment, start: derivedSampleCount(start), length: derivedSampleCount(length) };
}

/** The segments covering `[start, end)` of the stream, cut at both ends. */
export function sliceSegments(
  segments: readonly PlanSegment[],
  start: number,
  end: number,
): PlanSegment[] {
  const sliced: PlanSegment[] = [];
  let position = 0;
  for (const segment of segments) {
    const segmentEnd = position + segment.length;
    const from = Math.max(start, position);
    const to = Math.min(end, segmentEnd);
    if (from < to) sliced.push(sliceSegment(segment, from - position, to - from));
    position = segmentEnd;
    if (position >= end) break;
  }
  return sliced;
}

/** The stream with `[start, end)` played backwards: its segments in reverse, each turned round. */
export function reverseRange(
  segments: readonly PlanSegment[],
  start: number,
  end: number,
  total: number,
): PlanSegment[] {
  const turned = sliceSegments(segments, start, end)
    .reverse()
    .map((segment) => ({ ...segment, reversed: !segment.reversed }));
  return [...sliceSegments(segments, 0, start), ...turned, ...sliceSegments(segments, end, total)];
}

/**
 * The stream with each segment's part inside `[start, end)` given to
 * `change`, with where that part begins in the stream, and the rest kept.
 */
export function changeRange(
  segments: readonly PlanSegment[],
  start: number,
  end: number,
  change: (segment: PlanSegment, segmentStart: number) => PlanSegment,
): PlanSegment[] {
  const changed: PlanSegment[] = [];
  let position = 0;
  for (const segment of segments) {
    const segmentEnd = position + segment.length;
    const from = Math.max(start, position);
    const to = Math.min(end, segmentEnd);
    if (from >= to) {
      changed.push(segment);
    } else {
      if (from > position) changed.push(sliceSegment(segment, 0, from - position));
      changed.push(change(sliceSegment(segment, from - position, to - from), from));
      if (to < segmentEnd) changed.push(sliceSegment(segment, to - position, segmentEnd - to));
    }
    position = segmentEnd;
  }
  return changed;
}
