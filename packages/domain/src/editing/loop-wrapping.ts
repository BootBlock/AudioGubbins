/**
 * A looping region's sound with its processing wrapped across its loop
 * (ADR-0107), made of the plan's own streams, segments and mixes, so the
 * engine renders it as it renders any plan and no reader needs a path of its
 * own.
 *
 * For a region of length L whose loop runs from S to E, its body B = E − S:
 *
 * - the warm-up input is the region's audio before its racks, its loop's body
 *   k times and then the region from S to L (`warmUpInput`), which the caller
 *   runs through the asset's rack and the region's, as the ordinary run is;
 * - the region is the ordinary run before S and that wrapped run from k·B on
 *   (`joinedAtLoopStart`), the warm-up read and discarded as the renderer
 *   discards a chain's latency, so no length, anchor or position moves;
 * - the last J frames before S are the ordinary run faded out summed with the
 *   wrapped run's last J frames of warm-up faded in, equal power, so the intro
 *   reaches S with no jump in the processors' state. The splice lies in the
 *   intro, which plays once, so no repeat hears it. A loop that starts with
 *   its region has no intro, and the region is the wrapped run from k·B.
 *
 * The body repeated k times is held by doubling (each stream two readings of
 * the one after it), so a short loop under a long lead-in costs a plan a few
 * streams rather than a segment for every cycle.
 */

import type { LoopDefinition } from '../project/timeline.js';
import { derivedSampleCount } from '../time/sample-time.js';
import type { Span } from './anchors.js';
import { fadedSpan, mixed } from './faded-joins.js';
import { FadeDirection, FadeShape } from './fades.js';
import { segmentsLength, type EditPlan, type PlanSegment, type PlanStream } from './plan.js';
import { sliceSegments } from './segment-list.js';
import { renumberStream, shiftStreams } from './stream-tables.js';

/** How long the splice into the loop's start is where the loop has no crossfade to take it from. */
const SPLICE_SECONDS = 0.01;

/**
 * How many frames the splice into the loop's start crosses at `sampleRate`:
 * the loop's crossfade where it has one, 10 ms otherwise, and never more than
 * the intro holds. `loop` is placed, so its crossfade already fits its start.
 */
export function introSpliceLength(loop: LoopDefinition, sampleRate: number): number {
  const wanted =
    loop.crossfadeLength > 0 ? loop.crossfadeLength : Math.round(sampleRate * SPLICE_SECONDS);
  return Math.min(loop.loopStart, wanted);
}

/** One segment reading `length` frames of stream `place` from its start. */
function reading(place: number, length: number): PlanSegment {
  return {
    source: { kind: 'stream', stream: place },
    start: derivedSampleCount(0),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/**
 * `edited`, a region's asset before its racks, as the warm-up input of its
 * loop: one stream of the loop's body `cycles` times then the region from the
 * loop's start, read from `span`, the region's span of `edited`'s first
 * stream. The streams `edited` already had stay its last, in their order,
 * after those this adds.
 */
export function warmUpInput(
  edited: EditPlan,
  span: Span,
  loop: LoopDefinition,
  cycles: number,
): EditPlan {
  const body = loop.loopEnd - loop.loopStart;
  const from = span.start + loop.loopStart;
  if (cycles === 1) {
    const [sound, ...others] = edited.streams;
    const segments = sliceSegments(sound.segments, from, from + body);
    const rest = sliceSegments(sound.segments, from, span.end);
    return { streams: [{ ...sound, segments: [...segments, ...rest] }, ...others] };
  }
  // Stream 1 + (top − j) holds 2^j cycles: the body itself for j = 0, and two
  // readings of the stream after it otherwise.
  const top = Math.floor(Math.log2(cycles));
  const [sound, ...others] = shiftStreams(edited.streams, top + 1);
  const meta = { sampleRate: sound.sampleRate, layout: sound.layout };
  const doubled: PlanStream[] = [];
  for (let j = top; j >= 0; j -= 1) {
    const half = 2 ** (j - 1) * body;
    doubled.push({
      ...meta,
      segments:
        j === 0
          ? sliceSegments(sound.segments, from, from + body)
          : [reading(2 + top - j, half), reading(2 + top - j, half)],
    });
  }
  const warmUp: PlanSegment[] = [];
  let left = cycles;
  for (let j = top; j >= 0; j -= 1) {
    const held = 2 ** j;
    if (left < held) continue;
    warmUp.push(reading(1 + top - j, held * body));
    left -= held;
  }
  const rest = sliceSegments(sound.segments, from, span.end);
  return { streams: [{ ...sound, segments: [...warmUp, ...rest] }, ...doubled, ...others] };
}

/**
 * A looping region's sound from its two runs (ADR-0107): `ordinary`, its
 * processing run from the region's start, and `wrapped`, run over its
 * `warmUpInput` of `cycles` cycles. Neither is pruned, and each ends with the
 * same `shared` streams, those of the asset's plan before its racks, which
 * both read and the result holds once. `loop` is placed.
 */
export function joinedAtLoopStart(
  ordinary: EditPlan,
  wrapped: EditPlan,
  shared: number,
  loop: LoopDefinition,
  cycles: number,
): EditPlan {
  const { loopStart: start, loopEnd: end } = loop;
  const warmUp = cycles * (end - start);
  const [wrappedSound, ...wrappedOthers] = wrapped.streams;
  const after = segmentsLength(wrappedSound);
  if (start === 0) {
    const segments = sliceSegments(wrappedSound.segments, warmUp, after);
    return { streams: [{ ...wrappedSound, segments }, ...wrappedOthers] };
  }
  const ownOrdinary = ordinary.streams.length - 1 - shared;
  const ownWrapped = wrapped.streams.length - 1 - shared;
  // Places 1 and 2 are the splice's two sides; then come the ordinary run's
  // own streams, the wrapped run's own, and the shared ones.
  const fromOrdinary = (place: number) =>
    place <= ownOrdinary ? 2 + place : 2 + ownWrapped + place;
  const fromWrapped = (place: number) => 2 + ownOrdinary + place;
  const heard = renumberStream(ordinary.streams[0], fromOrdinary);
  const heardOthers = ordinary.streams
    .slice(1)
    .map((stream) => renumberStream(stream, fromOrdinary));
  const run = renumberStream(wrappedSound, fromWrapped);
  const runOthers = wrappedOthers.map((stream) => renumberStream(stream, fromWrapped));
  const splice = introSpliceLength(loop, heard.sampleRate);
  return {
    streams: [
      {
        sampleRate: heard.sampleRate,
        layout: heard.layout,
        segments: [
          ...sliceSegments(heard.segments, 0, start - splice),
          mixed([1, 2], splice),
          ...sliceSegments(run.segments, warmUp, after),
        ],
      },
      fadedSpan(heard, start - splice, splice, FadeDirection.Out, FadeShape.EqualPower),
      fadedSpan(run, warmUp - splice, splice, FadeDirection.In, FadeShape.EqualPower),
      ...heardOthers.slice(0, ownOrdinary),
      ...runOthers.slice(0, ownWrapped),
      ...heardOthers.slice(ownOrdinary),
    ],
  };
}
