/**
 * Renumbering a plan's streams.
 *
 * A segment names the stream it reads by its place in the plan, always a
 * place after its own stream's, so streams can be moved between plans and
 * dropped without a cycle ever forming. When a payload joins a plan its
 * streams are shifted past those already there; when a deletion leaves a
 * stream that nothing reads, the stream is dropped and the rest renumbered.
 */

import type { EditPlan, PlanSegment, PlanStream } from './plan.js';

/** A segment's source renumbered by `renumber`, where it reads a stream. */
function renumbered(segment: PlanSegment, renumber: (stream: number) => number): PlanSegment {
  return segment.source.kind === 'stream'
    ? { ...segment, source: { kind: 'stream', stream: renumber(segment.source.stream) } }
    : segment;
}

/** The streams with every stream a segment reads moved `by` places on. */
export function shiftStreams(
  streams: EditPlan['streams'],
  by: number,
): readonly [PlanStream, ...PlanStream[]] {
  const [first, ...rest] = streams.map((stream) => ({
    ...stream,
    segments: stream.segments.map((segment) => renumbered(segment, (place) => place + by)),
  }));
  return [first ?? streams[0], ...rest];
}

/** The plan with only the streams its first stream reads, directly or through another. */
export function pruneStreams(plan: EditPlan): EditPlan {
  const read = new Set<number>([0]);
  // A stream reads only later streams, so one pass in order finds everything
  // the first stream reaches.
  plan.streams.forEach((stream, place) => {
    if (!read.has(place)) return;
    for (const segment of stream.segments) {
      if (segment.source.kind === 'stream') read.add(segment.source.stream);
    }
  });
  if (read.size === plan.streams.length) return plan;
  const places = new Map<number, number>();
  for (const place of [...read].sort((left, right) => left - right)) places.set(place, places.size);
  const kept = plan.streams
    .filter((_, place) => read.has(place))
    .map((stream) => ({
      ...stream,
      segments: stream.segments.map((segment) =>
        renumbered(segment, (place) => places.get(place) ?? place),
      ),
    }));
  const [first, ...rest] = kept;
  return { streams: [first ?? plan.streams[0], ...rest] };
}
