/**
 * A preview voice's own streams in its plan (ADR-0104): the member it plays,
 * copied, so no two voices ever read one stream (a chain or a conversion read
 * at two places starts again on every read); the voice's run of it, from its
 * offset and, for a loop, cycling past the plan's end; and, where it has a
 * pitch, that run played at the pitch's ratio by a varispeed stream.
 *
 * In the order a plan needs, each reading only later streams: the varispeed,
 * then the run, then the member's streams. Every one is at the member's rate
 * and layout; the lane that reads the voice converts it to the preview's.
 */

import {
  VARISPEED_DENOMINATOR,
  convertedFrameCount,
  derivedSampleCount,
  segmentsLength,
  type EditPlan,
  type PlanSegment,
  type PlanSource,
  type PlanStream,
} from '@audiogubbins/domain';

import type { PoolMember } from './preview-subjects.js';

/**
 * How many frames past what its lane reads a looping voice's run holds, so
 * the resampler that converts or varies it always reads real audio ahead.
 */
const RUN_MARGIN = 8_192;

/** Where a voice's streams are, and what its lane reads. */
export interface VoiceStreams {
  /** The stream its lane reads: the varispeed, or the run where it has no pitch. */
  readonly heard: number;
  readonly run: number;
  readonly member: number;
}

function reading(source: PlanSource, start: number, length: number): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/** `segment` with every stream it reads moved `by` places on. */
function shifted(segment: PlanSegment, by: number): PlanSegment {
  const { source } = segment;
  if (source.kind === 'stream') {
    return { ...segment, source: { kind: 'stream', stream: source.stream + by } };
  }
  if (source.kind === 'mix') {
    return { ...segment, source: { kind: 'mix', streams: source.streams.map((one) => one + by) } };
  }
  return segment;
}

/** The frames of the preview at `rate` a run of `frames` of `member` at `numerator` makes. */
function heardFrames(member: PoolMember, frames: number, numerator: number, rate: number): number {
  const varied =
    numerator === VARISPEED_DENOMINATOR
      ? frames
      : convertedFrameCount(frames, numerator, VARISPEED_DENOMINATOR);
  return member.sampleRate === rate ? varied : convertedFrameCount(varied, member.sampleRate, rate);
}

/**
 * The segments of a voice's run of `member` (whose sound is stream `sound`)
 * from `offset`: to its end, or, for a loop, its loop's end and then cycles of
 * the loop until it makes at least `heard` frames at `rate` and a margin.
 */
function runSegments(
  member: PoolMember,
  sound: number,
  offset: number,
  numerator: number,
  rate: number,
  heard: number,
): readonly PlanSegment[] {
  const source: PlanSource = { kind: 'stream', stream: sound };
  const { loop } = member;
  if (loop === undefined) return [reading(source, offset, member.length - offset)];
  const intro = loop.end - offset;
  const cycle = loop.end - loop.start;
  const wanted = heard + RUN_MARGIN;
  // The member's frames that make `wanted`, each conversion's ceiling taken
  // back, then as many cycles as reach them, and one more where rounding fell short.
  const varied = Math.ceil((wanted * member.sampleRate) / rate) + 1;
  const frames = Math.ceil((varied * numerator) / VARISPEED_DENOMINATOR) + 1;
  let cycles = Math.max(0, Math.ceil((frames - intro) / cycle));
  while (heardFrames(member, intro + cycles * cycle, numerator, rate) < wanted) cycles += 1;
  return [
    reading(source, offset, intro),
    ...Array.from({ length: cycles }, () => reading(source, loop.start, cycle)),
  ];
}

/** The varispeed stream over a run of `runFrames` at stream `run`, or none at its member's pitch. */
function varispeedOver(
  sound: PlanStream,
  run: number,
  runFrames: number,
  numerator: number,
): PlanStream {
  return {
    sampleRate: sound.sampleRate,
    layout: sound.layout,
    segments: [reading({ kind: 'stream', stream: run }, 0, runFrames)],
    processing: { kind: 'varispeed', numerator, denominator: VARISPEED_DENOMINATOR },
  };
}

/**
 * Appends a voice's streams to `streams`: `plan`, the member's, copied, its
 * run from `offset` making at least `heard` frames at `rate`, and its
 * varispeed at `numerator` where that is not unison.
 */
export function appendVoiceStreams(
  streams: PlanStream[],
  plan: EditPlan,
  member: PoolMember,
  voice: { readonly offset: number; readonly numerator: number; readonly heard: number },
  rate: number,
): VoiceStreams {
  const pitched = voice.numerator !== VARISPEED_DENOMINATOR;
  const heard = streams.length;
  const run = pitched ? heard + 1 : heard;
  const first = run + 1;
  const [sound] = plan.streams;
  const segments = runSegments(member, first, voice.offset, voice.numerator, rate, voice.heard);
  const runStream: PlanStream = { sampleRate: sound.sampleRate, layout: sound.layout, segments };
  if (pitched) streams.push(varispeedOver(sound, run, segmentsLength(runStream), voice.numerator));
  streams.push(runStream);
  for (const stream of plan.streams) {
    streams.push({
      ...stream,
      segments: stream.segments.map((segment) => shifted(segment, first)),
    });
  }
  return { heard, run, member: first };
}

/**
 * A looping voice's run and varispeed in `streams` lengthened, by whole
 * cycles, to make at least `heard` frames at `rate`: what a later end of the
 * plan asks, every earlier frame unchanged.
 */
export function lengthenLoop(
  streams: PlanStream[],
  at: VoiceStreams,
  member: PoolMember,
  voice: { readonly offset: number; readonly numerator: number },
  rate: number,
  heard: number,
): void {
  const run = streams[at.run];
  if (run === undefined) throw new Error('A voice keeps its run.');
  const segments = runSegments(member, at.member, voice.offset, voice.numerator, rate, heard);
  if (segments.length <= run.segments.length) return;
  streams[at.run] = { ...run, segments };
  if (at.heard !== at.run) {
    const varispeed = streams[at.heard];
    if (varispeed === undefined) throw new Error('A pitched voice keeps its varispeed.');
    streams[at.heard] = {
      ...varispeed,
      segments: [reading({ kind: 'stream', stream: at.run }, 0, segmentsLength({ segments }))],
    };
  }
}
