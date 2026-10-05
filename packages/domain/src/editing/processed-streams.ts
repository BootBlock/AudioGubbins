/**
 * Making a stream of a plan that an earlier stream reads processed: a range
 * through a chain, a range stretched, the whole sound converted to another
 * rate, or the whole sound through a target's rack (ADR-0060).
 *
 * Each takes some of the first stream's segments into a new stream at place
 * 1, after moving every stream already there one place on, and leaves in
 * their place one segment that reads the new stream from its start. A segment
 * still reads only a stream after its own, so the plan's order and its single
 * pass over the streams hold (`stream-tables.ts`). The new stream is rendered
 * from its own start, so what a segment reads of it is the same whichever
 * part of it is read first.
 */

import type { ChannelLayout } from '../audio/channel-layout.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { derivedSampleCount, type SampleRate } from '../time/sample-time.js';
import {
  convertedFrameCount,
  type EditPlan,
  type PlanSegment,
  type PlanStream,
  type StreamProcessing,
} from './plan.js';
import { sliceSegments } from './segment-list.js';
import { shiftStreams } from './stream-tables.js';

/** A plan being folded: its first stream, and every other stream from place 1 on. */
export interface Folding {
  readonly stream: PlanStream;
  readonly others: readonly PlanStream[];
}

/** The total length of a list of segments. */
export function lengthOf(segments: readonly PlanSegment[]): number {
  let length = 0;
  for (const segment of segments) length += segment.length;
  return length;
}

/** One segment that reads stream 1 from its start for `length` frames. */
function readerOfStreamOne(length: number): PlanSegment {
  return {
    source: { kind: 'stream', stream: 1 },
    start: derivedSampleCount(0),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/** The folding with every stream a segment reads moved one place on. */
function makingRoom(folding: Folding): Folding {
  const [stream, ...others] = shiftStreams([folding.stream, ...folding.others], 1);
  return { stream, others };
}

/**
 * The folding with `[start, end)` of its first stream taken into a new stream
 * that `processing` makes `made` frames of, which the first stream reads in
 * the range's place.
 */
function processedRange(
  folding: Folding,
  start: number,
  end: number,
  processing: StreamProcessing,
  made: number,
): Folding {
  const room = makingRoom(folding);
  const { stream } = room;
  const total = lengthOf(stream.segments);
  const taken: PlanStream = {
    sampleRate: stream.sampleRate,
    layout: stream.layout,
    segments: sliceSegments(stream.segments, start, end),
    processing,
  };
  return {
    stream: {
      ...stream,
      segments: [
        ...sliceSegments(stream.segments, 0, start),
        readerOfStreamOne(made),
        ...sliceSegments(stream.segments, end, total),
      ],
    },
    others: [taken, ...room.others],
  };
}

/** The folding with `[start, end)` of its first stream through `chain`, which keeps its layout. */
export function rackRange(
  folding: Folding,
  start: number,
  end: number,
  chain: EffectChain,
): Folding {
  const input = folding.stream.layout;
  return processedRange(folding, start, end, { kind: 'chain', chain, input }, end - start);
}

/** The folding with `[start, end)` of its first stream stretched to `length` frames. */
export function stretchRange(
  folding: Folding,
  start: number,
  end: number,
  length: number,
): Folding {
  return processedRange(
    folding,
    start,
    end,
    { kind: 'stretch', length: derivedSampleCount(length) },
    length,
  );
}

/** The folding with its whole first stream converted to `rate`. */
export function convertWhole(folding: Folding, rate: SampleRate): Folding {
  const room = makingRoom(folding);
  const { stream } = room;
  const length = convertedFrameCount(lengthOf(stream.segments), stream.sampleRate, rate);
  return {
    stream: { sampleRate: rate, layout: stream.layout, segments: [readerOfStreamOne(length)] },
    others: [stream, ...room.others],
  };
}

/**
 * The plan with its whole first stream through `chain`, which makes `layout`
 * of it: a target's rack, run over everything the target is.
 */
export function rackWhole(plan: EditPlan, chain: EffectChain, layout: ChannelLayout): EditPlan {
  const room = makingRoom({ stream: plan.streams[0], others: plan.streams.slice(1) });
  const { stream } = room;
  const processed: PlanStream = {
    ...stream,
    layout,
    processing: { kind: 'chain', chain, input: stream.layout },
  };
  return {
    streams: [
      {
        sampleRate: stream.sampleRate,
        layout,
        segments: [readerOfStreamOne(lengthOf(stream.segments))],
      },
      processed,
      ...room.others,
    ],
  };
}
