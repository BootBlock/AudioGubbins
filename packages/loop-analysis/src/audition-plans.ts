/**
 * Auditioning a loop by cycling it (ADR-0103, "Audition by cycling"): a plan
 * whose first stream is segments of the region's own sound, so what is heard
 * is exactly what the region's plan makes, its loop's crossfade included.
 *
 * - `cycles`: a lead-in of up to a second before S, then S to E repeated.
 * - `seam`: the frames either side of the seam, E − side to E then S to
 *   S + side, repeated: the jump heard again and again.
 *
 * The region's plan becomes the audition's second stream onwards, every
 * stream it names renumbered one on, so a candidate is auditioned from a plan
 * whose loop is the candidate's without writing it to the region. An
 * audition is extended by more cycles without changing a stream or any
 * segment before its old end, so a programme playing it continues gaplessly.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  streamLength,
  succeed,
  type DomainResult,
  type EditPlan,
  type LoopDefinition,
  type PlanSegment,
  type PlanSource,
  type PlanStream,
} from '@audiogubbins/domain';

/** How a loop is auditioned. */
export type LoopAuditionMode =
  /** Up to `leadInFrames` before S, at most a second and what the region has, then cycles of the loop. */
  | { readonly kind: 'cycles'; readonly leadInFrames: number }
  /** `sideFrames` each side of the seam, at most the loop's length, repeated. */
  | { readonly kind: 'seam'; readonly sideFrames: number };

/** An audition's plan, and the segments one more cycle appends. */
export interface LoopAudition {
  readonly plan: EditPlan;
  readonly cycle: readonly PlanSegment[];
}

/** The stream of the audition's plan the region's sound is. */
const REGION_STREAM = 1;

/** `source` with every stream it names one on, as the region's plan moves behind the audition's stream. */
function renumbered(source: PlanSource): PlanSource {
  switch (source.kind) {
    case 'stream':
      return { kind: 'stream', stream: source.stream + 1 };
    case 'mix':
      return { kind: 'mix', streams: source.streams.map((stream) => stream + 1) };
    case 'media':
    case 'silence':
      return source;
  }
}

/** `stream` with its segments' sources renumbered. */
function shifted(stream: PlanStream): PlanStream {
  return {
    ...stream,
    segments: stream.segments.map((segment) => ({
      ...segment,
      source: renumbered(segment.source),
    })),
  };
}

/** `length` frames of the region's sound from `start`. */
function regionSpan(start: number, length: number): PlanSegment {
  return {
    source: { kind: 'stream', stream: REGION_STREAM },
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/** `cycle` repeated `cycles` times. */
function repeated(cycle: readonly PlanSegment[], cycles: number): readonly PlanSegment[] {
  const segments: PlanSegment[] = [];
  for (let index = 0; index < cycles; index += 1) segments.push(...cycle);
  return segments;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The audition of `loop` in the region `regionPlan` makes, by `mode`, `cycles` times. */
export function loopAuditionPlan(
  regionPlan: EditPlan,
  loop: LoopDefinition,
  mode: LoopAuditionMode,
  cycles: number,
): DomainResult<LoopAudition> {
  const [sound, ...rest] = regionPlan.streams;
  const length = streamLength(sound);
  const start: number = loop.loopStart;
  const end: number = loop.loopEnd;
  if (start >= end || end > length) {
    return refused('loop.outside-region', 'A loop is auditioned only inside its region.');
  }
  if (!Number.isSafeInteger(cycles) || cycles < 1) {
    return refused('loop.audition-cycles-invalid', 'An audition plays at least one whole cycle.');
  }
  const asked = mode.kind === 'cycles' ? mode.leadInFrames : mode.sideFrames;
  if (!Number.isSafeInteger(asked) || asked < 0) {
    return refused(
      'loop.audition-span-invalid',
      "An audition's lead-in or side is a whole number of frames.",
    );
  }
  let lead: readonly PlanSegment[] = [];
  let cycle: readonly PlanSegment[];
  if (mode.kind === 'cycles') {
    const leadIn = Math.min(asked, start, sound.sampleRate);
    lead = leadIn === 0 ? [] : [regionSpan(start - leadIn, leadIn)];
    cycle = [regionSpan(start, end - start)];
  } else {
    const side = Math.min(asked, end - start);
    if (side === 0) {
      return refused(
        'loop.audition-span-invalid',
        'A seam audition plays at least one frame each side.',
      );
    }
    cycle = [regionSpan(end - side, side), regionSpan(start, side)];
  }
  return succeed({
    plan: {
      streams: [
        {
          sampleRate: sound.sampleRate,
          layout: sound.layout,
          segments: [...lead, ...repeated(cycle, cycles)],
        },
        shifted(sound),
        ...rest.map(shifted),
      ],
    },
    cycle,
  });
}

/** `audition` with `cycles` more cycles: every stream, and every segment before its old end, unchanged. */
export function extendedAuditionPlan(audition: LoopAudition, cycles: number): LoopAudition {
  const [first, ...rest] = audition.plan.streams;
  return {
    plan: {
      streams: [
        { ...first, segments: [...first.segments, ...repeated(audition.cycle, cycles)] },
        ...rest,
      ],
    },
    cycle: audition.cycle,
  };
}
