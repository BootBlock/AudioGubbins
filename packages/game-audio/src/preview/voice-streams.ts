/**
 * A preview voice's own streams in its plan (ADR-0104): the member it plays,
 * copied, so no two voices ever read one stream (a chain or a conversion read
 * at two places starts again on every read); the voice's run of it, from its
 * offset and, for a loop, cycling past the plan's end; and, where it has a
 * pitch, that run played at the pitch's ratio by a varispeed stream.
 *
 * In the order a plan needs, each reading only later streams: the varispeed,
 * then the run, then the member's streams, at places in a row the plan gives
 * (`stream-places.ts`). Every one is at the member's rate and layout; the lane
 * that reads the voice converts it to the preview's.
 *
 * A looping voice's run grows a cycle at a time as the plan's end moves on; a
 * plan that has played for long forgets the cycles its readers have read past
 * ({@link forgetRun}), one segment of silence as long in their place, so a loop
 * never stopped holds the cycles still to be heard.
 */

import {
  VARISPEED_DENOMINATOR,
  channelCount,
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
  /** The stream its lane reads, and its first: the varispeed, or the run where it has no pitch. */
  readonly heard: number;
  readonly run: number;
  readonly member: number;
  /** How many places in a row its streams take from `heard`. */
  readonly count: number;
}

/** The leading segments of a looping voice's run the plan has forgotten, and their frames. */
export interface RunForgotten {
  readonly segments: number;
  readonly frames: number;
}

/** A run of which nothing is forgotten. */
export const NOTHING_FORGOTTEN: RunForgotten = { segments: 0, frames: 0 };

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
 * The segments of a voice's run of `member` (whose sound is stream `sound`, of
 * `channels` channels) from `offset`: to its end, or, for a loop, its loop's
 * end and then cycles of the loop until it makes at least `heard` frames at
 * `rate` and a margin; the first of them `forgotten` says, silence in their
 * place.
 */
function runSegments(
  member: PoolMember,
  sound: { readonly stream: number; readonly channels: number },
  voice: { readonly offset: number; readonly numerator: number },
  rate: number,
  heard: number,
  forgotten: RunForgotten,
): readonly PlanSegment[] {
  const source: PlanSource = { kind: 'stream', stream: sound.stream };
  const { offset, numerator } = voice;
  const { loop } = member;
  if (loop === undefined) return [reading(source, offset, member.length - offset)];
  const intro = loop.end - offset;
  const cycle = loop.end - loop.start;
  const wanted = heard + RUN_MARGIN;
  // The member's frames that make `wanted`, each conversion's ceiling taken
  // back, then as many cycles as reach them, and one more where rounding fell
  // short.
  const varied = Math.ceil((wanted * member.sampleRate) / rate) + 1;
  const frames = Math.ceil((varied * numerator) / VARISPEED_DENOMINATOR) + 1;
  let cycles = Math.max(0, Math.ceil((frames - intro) / cycle));
  while (heardFrames(member, intro + cycles * cycle, numerator, rate) < wanted) cycles += 1;
  if (forgotten.segments === 0) {
    return [
      reading(source, offset, intro),
      ...Array.from({ length: cycles }, () => reading(source, loop.start, cycle)),
    ];
  }
  // The intro and the first cycles forgotten: only the cycles after them are laid.
  const silence: PlanSource = { kind: 'silence', channels: sound.channels };
  return [
    reading(silence, 0, forgotten.frames),
    ...Array.from({ length: Math.max(0, cycles + 1 - forgotten.segments) }, () =>
      reading(source, loop.start, cycle),
    ),
  ];
}

/** A voice's run stream: its segments, at its sound's rate and layout, forgetting what `forgotten` says. */
function runStream(
  sound: PlanStream,
  segments: readonly PlanSegment[],
  forgotten: RunForgotten,
): PlanStream {
  return {
    sampleRate: sound.sampleRate,
    layout: sound.layout,
    segments,
    ...(forgotten.frames === 0 ? {} : { forgottenBefore: derivedSampleCount(forgotten.frames) }),
  };
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

/** How many places a voice of `plan` takes: its run and the member's streams, and a varispeed where it is pitched. */
export function voicePlaces(plan: EditPlan, numerator: number): number {
  return (numerator === VARISPEED_DENOMINATOR ? 1 : 2) + plan.streams.length;
}

/**
 * Puts a voice's streams in `streams` from place `at` ({@link voicePlaces} of
 * them): `plan`, the member's, copied, its run from `offset` making at least
 * `heard` frames at `rate`, and its varispeed at `numerator` where that is not
 * unison.
 */
export function placeVoiceStreams(
  streams: PlanStream[],
  at: number,
  plan: EditPlan,
  member: PoolMember,
  voice: { readonly offset: number; readonly numerator: number; readonly heard: number },
  rate: number,
): VoiceStreams {
  const pitched = voice.numerator !== VARISPEED_DENOMINATOR;
  const heard = at;
  const run = pitched ? heard + 1 : heard;
  const first = run + 1;
  const [sound] = plan.streams;
  const channels = channelCount(sound.layout);
  const segments = runSegments(
    member,
    { stream: first, channels },
    voice,
    rate,
    voice.heard,
    NOTHING_FORGOTTEN,
  );
  const ran = runStream(sound, segments, NOTHING_FORGOTTEN);
  if (pitched) streams[heard] = varispeedOver(sound, run, segmentsLength(ran), voice.numerator);
  streams[run] = ran;
  for (const [index, stream] of plan.streams.entries()) {
    streams[first + index] = {
      ...stream,
      segments: stream.segments.map((segment) => shifted(segment, first)),
    };
  }
  return { heard, run, member: first, count: first + plan.streams.length - heard };
}

/** The varispeed of a pitched voice at `at` over its run as it now is. */
function revaried(streams: PlanStream[], at: VoiceStreams): void {
  if (at.heard === at.run) return;
  const varispeed = streams[at.heard];
  const run = streams[at.run];
  if (varispeed === undefined || run === undefined) {
    throw new Error('A pitched voice keeps its varispeed and its run.');
  }
  streams[at.heard] = {
    ...varispeed,
    segments: [reading({ kind: 'stream', stream: at.run }, 0, segmentsLength(run))],
  };
}

/**
 * A looping voice's run and varispeed in `streams` lengthened, by whole
 * cycles, to make at least `heard` frames at `rate`: what a later end of the
 * plan asks, every earlier frame unchanged, what it has forgotten still so.
 */
export function lengthenLoop(
  streams: PlanStream[],
  at: VoiceStreams,
  member: PoolMember,
  voice: {
    readonly offset: number;
    readonly numerator: number;
    readonly runForgotten: RunForgotten;
  },
  rate: number,
  heard: number,
): void {
  const run = streams[at.run];
  if (run === undefined) throw new Error('A voice keeps its run.');
  const sound = streams[at.member];
  if (sound === undefined) throw new Error('A voice keeps its member.');
  const segments = runSegments(
    member,
    { stream: at.member, channels: channelCount(sound.layout) },
    voice,
    rate,
    heard,
    voice.runForgotten,
  );
  if (segments.length <= run.segments.length) return;
  streams[at.run] = runStream(run, segments, voice.runForgotten);
  revaried(streams, at);
}

/**
 * A looping voice's run in `streams` with every segment that ends by its frame
 * `before` forgotten, silence as long in their place, and what is forgotten of
 * it now; its varispeed reads it as before.
 */
export function forgetRun(
  streams: PlanStream[],
  at: VoiceStreams,
  forgotten: RunForgotten,
  before: number,
): RunForgotten {
  const run = streams[at.run];
  const sound = streams[at.member];
  if (run === undefined || sound === undefined) throw new Error('A voice keeps its run.');
  let segments = 0;
  let frames = 0;
  for (const one of run.segments) {
    if (frames + one.length > before) break;
    frames += one.length;
    segments += 1;
  }
  // A segment of the run's own silence stands for the forgotten before it.
  const count = forgotten.segments === 0 ? segments : forgotten.segments - 1 + segments;
  if (frames <= forgotten.frames || segments === 0) return forgotten;
  const silence: PlanSource = { kind: 'silence', channels: channelCount(sound.layout) };
  const now = { segments: count, frames };
  streams[at.run] = runStream(
    run,
    [reading(silence, 0, frames), ...run.segments.slice(segments)],
    now,
  );
  return now;
}
