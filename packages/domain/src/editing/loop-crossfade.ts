/**
 * A loop's crossfade, realised in its region's plan (ADR-0103).
 *
 * A game engine that loops a sound jumps from the loop's end E back to its
 * start S, and a file holds the loop's points alone (ADR-0093), so a crossfade
 * only an editor applied as it played would be lost in every export. The
 * crossfade is therefore part of the region's sound: the last C frames of the
 * loop become its end faded out summed with the C frames before S faded in, so
 * the jump from E − 1 to S lands where the faded-in audio was heading. Where
 * the region goes on past E, its first C′ = min(C, region end − E) frames
 * after E become the audio after S faded out summed with the audio after E
 * faded in, so a playthrough that does not loop leaves E without a jump
 * either. Both joins take the loop's shape, by the plan's one fade function.
 *
 * Each join is a mix of two streams of one segment each, as a punch's
 * boundary is (ADR-0072): the side faded out first, then the side faded in.
 * The crossfade reads the region's sound as its rack made it, so it is
 * applied to a region's plan after its rack, and the region's plan without it
 * is what a search for better loop points reads (`regionPlan`'s
 * `loopCrossfade`).
 */

import { channelCount } from '../audio/channel-layout.js';
import type { LoopDefinition } from '../project/timeline.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { FadeDirection, type FadeShape } from './fades.js';
import { segmentsLength, type EditPlan, type PlanSegment, type PlanStream } from './plan.js';
import { rangeEditStage } from './range-stages.js';
import { changeRange, sliceSegments } from './segment-list.js';
import { shiftStreams } from './stream-tables.js';

/** One segment reading `length` frames of the mix of `streams` from their start. */
function mixed(streams: readonly [number, number], length: number): PlanSegment {
  return {
    source: { kind: 'mix', streams },
    start: derivedSampleCount(0),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/** `[start, start + length)` of `stream`'s segments as a stream of its own, faded `direction`. */
function fadedSpan(
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

/**
 * `plan`, a region's sound, with `loop`'s crossfade made part of it: the
 * plan unchanged where the loop has none. `loop` is placed (`placeRegion`), so
 * its crossfade is at most its start and its length.
 */
export function withLoopCrossfade(plan: EditPlan, loop: LoopDefinition): EditPlan {
  const fade = loop.crossfadeLength;
  if (fade === 0) return plan;
  const { loopStart: start, loopEnd: end, crossfadeShape: shape } = loop;
  const total = segmentsLength(plan.streams[0]);
  const after = Math.min(fade, total - end);
  const joins = after > 0 ? 4 : 2;
  // Every stream already there moves past the joins' streams, which read it.
  const [sound, ...others] = shiftStreams(plan.streams, joins);
  const joinStreams = [
    fadedSpan(sound, end - fade, fade, FadeDirection.Out, shape),
    fadedSpan(sound, start - fade, fade, FadeDirection.In, shape),
    ...(after > 0
      ? [
          fadedSpan(sound, start, after, FadeDirection.Out, shape),
          fadedSpan(sound, end, after, FadeDirection.In, shape),
        ]
      : []),
  ];
  return {
    streams: [
      {
        ...sound,
        segments: [
          ...sliceSegments(sound.segments, 0, end - fade),
          mixed([1, 2], fade),
          ...(after > 0
            ? [mixed([3, 4], after), ...sliceSegments(sound.segments, end + after, total)]
            : []),
        ],
      },
      ...joinStreams,
      ...others,
    ],
  };
}
