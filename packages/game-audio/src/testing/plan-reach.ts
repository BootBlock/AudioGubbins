/**
 * What a test of a preview plan's continuation reads of two plans: how far
 * into each stream a plan's sound reads to make its first frames, and the
 * first frame at which a stream of a continuing plan may read differently
 * from the one it continues, as the engine's continuation decides whether a
 * reader goes on (`plan-divergence.ts` of `@audiogubbins/audio-engine`), told
 * here in the plan's own terms so a test of the plan needs no engine.
 */

import type {
  AutomationPoint,
  EditPlan,
  ParameterAutomation,
  PlanSegment,
  PlanStream,
} from '@audiogubbins/domain';

/** How far past a frame a resampler reads, at most, at preview quality and above. */
const REACH = 4_096;

/**
 * How far into each stream `plan`'s sound reads to make its first `frames`:
 * from the first stream, through each segment that starts before what is
 * read of its stream, to what it reads of its source, through a varispeed or
 * a conversion by its ratio, with a filter's reach past it.
 */
export function readsBefore(plan: EditPlan, frames: number): readonly number[] {
  const reach = plan.streams.map(() => 0);
  reach[0] = frames;
  for (const [place, stream] of plan.streams.entries()) {
    const limit = reach[place] ?? 0;
    let position = 0;
    for (const segment of stream.segments) {
      if (position >= limit) break;
      const read = segment.start + Math.min(segment.length, limit - position);
      const sources =
        segment.source.kind === 'stream'
          ? [segment.source.stream]
          : segment.source.kind === 'mix'
            ? segment.source.streams
            : [];
      for (const source of sources) {
        const target = plan.streams[source];
        if (target === undefined) continue;
        let needed = read;
        if (stream.processing?.kind === 'varispeed') {
          needed =
            Math.ceil((read * stream.processing.numerator) / stream.processing.denominator) + REACH;
        }
        if (target.sampleRate !== stream.sampleRate) {
          needed = Math.ceil((needed * target.sampleRate) / stream.sampleRate) + REACH;
        }
        reach[source] = Math.max(reach[source] ?? 0, needed);
      }
      position += segment.length;
    }
  }
  return reach;
}

/** The index of the first of `segments` that ends after `from`, and where it starts. */
function segmentFrom(
  segments: readonly PlanSegment[],
  from: number,
): { readonly index: number; readonly position: number } {
  let index = 0;
  let position = 0;
  for (let segment = segments[0]; segment !== undefined; segment = segments[index]) {
    if (position + segment.length > from) break;
    position += segment.length;
    index += 1;
  }
  return { index, position };
}

/** `points` from the last one at or before `from`. */
function pointsFrom(points: readonly AutomationPoint[], from: number): readonly AutomationPoint[] {
  let first = 0;
  while ((points[first + 1]?.frame ?? Number.POSITIVE_INFINITY) <= from) first += 1;
  return from === 0 ? points : points.slice(first);
}

/**
 * The first frame of its own, from where `after` says it remembers, at which
 * `after` may read differently from `before`: from there where they differ in
 * rate, layout, processing or automation; the end of the segments they share
 * from there; and within a pair that reads alike but for its length, the
 * shorter's end; infinite where they are one.
 */
export function firstDifference(before: PlanStream, after: PlanStream): number {
  const from = after.forgottenBefore ?? 0;
  const { automation: wasAutomation, ...was } =
    before.processing?.kind === 'chain' ? before.processing : { automation: undefined };
  const { automation: nowAutomation, ...now } =
    after.processing?.kind === 'chain' ? after.processing : { automation: undefined };
  if (
    before.sampleRate !== after.sampleRate ||
    JSON.stringify(before.layout) !== JSON.stringify(after.layout) ||
    JSON.stringify(before.processing?.kind === 'chain' ? was : before.processing) !==
      JSON.stringify(after.processing?.kind === 'chain' ? now : after.processing)
  ) {
    return 0;
  }
  const moved = automationDifference(wasAutomation ?? [], nowAutomation ?? [], from);
  return Math.min(moved, segmentsDifference(before, after, from));
}

/**
 * The first frame from `from` at which two chains' automation may give a
 * parameter another value: just past the last point a pair of lanes shares.
 */
function automationDifference(
  before: readonly ParameterAutomation[],
  after: readonly ParameterAutomation[],
  from: number,
): number {
  if (before.length !== after.length) return from;
  let differs = Number.POSITIVE_INFINITY;
  for (const [index, lane] of before.entries()) {
    const other = after[index];
    if (other?.processor !== lane.processor || other.parameter !== lane.parameter) return from;
    const was = pointsFrom(lane.points, from);
    const now = pointsFrom(other.points, from);
    let shared = 0;
    while (
      shared < was.length &&
      was[shared]?.frame === now[shared]?.frame &&
      was[shared]?.value === now[shared]?.value
    ) {
      shared += 1;
    }
    if (shared === was.length && shared === now.length) continue;
    const last = was[shared - 1];
    differs = Math.min(differs, last === undefined ? from : Math.max(from, last.frame + 1));
  }
  return differs;
}

/** The first frame from `from` at which two streams' segments read differently. */
function segmentsDifference(before: PlanStream, after: PlanStream, from: number): number {
  const old = segmentFrom(before.segments, from);
  const young = segmentFrom(after.segments, from);
  if (old.position !== young.position) return from;
  let { position } = old;
  for (let offset = 0; ; offset += 1) {
    const was = before.segments[old.index + offset];
    const now = after.segments[young.index + offset];
    if (was === undefined || now === undefined)
      return was === now ? Number.POSITIVE_INFINITY : position;
    const { length: oldLength, ...oldReading } = was;
    const { length: youngLength, ...youngReading } = now;
    if (JSON.stringify(oldReading) !== JSON.stringify(youngReading)) return position;
    if (oldLength !== youngLength) return position + Math.min(oldLength, youngLength);
    position += oldLength;
  }
}
