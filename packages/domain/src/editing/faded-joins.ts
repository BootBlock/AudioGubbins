/**
 * Joining two sounds by fades in a plan: a span of a stream taken into a
 * stream of its own and faded, and one segment that reads the sum of two such
 * streams through the plan's mix source (`plan.ts`). A loop's crossfade
 * (ADR-0103) and the splice that leads a loop's intro into its wrapped body
 * (ADR-0107) are each made of these, so both fade by the plan's one fade
 * function and sum by its one mix.
 */

import { channelCount } from '../audio/channel-layout.js';
import { derivedSampleCount } from '../time/sample-time.js';
import type { FadeDirection, FadeShape } from './fades.js';
import type { PlanSegment, PlanStream } from './plan.js';
import { rangeEditStage } from './range-stages.js';
import { changeRange, sliceSegments } from './segment-list.js';

/** One segment reading `length` frames of the mix of `streams` from their start. */
export function mixed(streams: readonly [number, number], length: number): PlanSegment {
  return {
    source: { kind: 'mix', streams },
    start: derivedSampleCount(0),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/** `[start, start + length)` of `stream`'s segments as a stream of its own, faded `direction`. */
export function fadedSpan(
  stream: PlanStream,
  start: number,
  length: number,
  direction: FadeDirection,
  shape: FadeShape,
): PlanStream {
  const fade = rangeEditStage(
    { kind: 'fade', direction, shape },
    { start: derivedSampleCount(0), end: derivedSampleCount(length) },
    undefined,
    channelCount(stream.layout),
  );
  return {
    sampleRate: stream.sampleRate,
    layout: stream.layout,
    segments: changeRange(sliceSegments(stream.segments, start, start + length), 0, length, fade),
  };
}
