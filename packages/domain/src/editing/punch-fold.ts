/**
 * Folding a punch edit into a plan (ADR-0072): the range replaced by the
 * chosen take of the stack it names, crossing into the take and back.
 *
 * The take is read from its own unchanged recording, from the end of the
 * pre-roll shifted by its compensation, for as many of its frames as become
 * the range; a take at the rate of the audio it replaces is read directly,
 * one at another rate through a stream of its own that the take's stream
 * reads converted. The take's stream fades in over the first crossfade and
 * out over the last; a stream of the earlier audio holds what the range had
 * at each boundary, faded the other way, and silence between, which nothing
 * reads. Each boundary reads the two mixed, and the take is read alone
 * between them, so the punch changes no time and the earlier audio is still
 * in the chain beneath it. A stack with no chosen take leaves the range as it
 * was.
 */

import { channelCount } from '../audio/channel-layout.js';
import { chosenTake, type PunchRange, type Take } from '../project/take-stack.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { versionKnown } from './algorithm-version.js';
import { FadeDirection } from './fades.js';
import type { EditRange, PunchEdit } from './operations.js';
import type { PlanSegment, PlanSource, PlanStream } from './plan.js';
import type { PlanContext } from './plan-context.js';
import type { MediaShape } from './plan-validation.js';
import { lengthOf, type Folding } from './processed-streams.js';
import { punchTakeFrames } from './punch-validation.js';
import { rangeEditStage } from './range-stages.js';
import { changeRange, sliceSegments } from './segment-list.js';
import { shiftStreams } from './stream-tables.js';

/** A plan the punch cannot be folded into, since the project lacks what it names. */
function missing(code: string, summary: string, details: Record<string, string>) {
  return fail(failure(`editing.${code}`, FailureKind.IntegrityViolation, summary, { details }));
}

/** One unprocessed segment reading `length` frames of `source` from `start`. */
function reading(source: PlanSource, start: number, length: number): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/**
 * `segments`, `length` frames of a stream of `count` channels, faded
 * `opening` over the punch's first crossfade and `closing` over its last.
 */
function crossed(
  segments: readonly PlanSegment[],
  length: number,
  punch: PunchRange,
  count: number,
  [opening, closing]: readonly [FadeDirection, FadeDirection],
): PlanSegment[] {
  const fade = punch.crossfade.length;
  const stage = (direction: FadeDirection, start: number, end: number) =>
    rangeEditStage(
      { kind: 'fade', direction, shape: punch.crossfade.shape },
      { start: derivedSampleCount(start), end: derivedSampleCount(end) },
      undefined,
      count,
    );
  const opened = changeRange(segments, 0, fade, stage(opening, 0, fade));
  return changeRange(opened, length - fade, length, stage(closing, length - fade, length));
}

/** Where the punch's new streams are placed, and what the take is read from. */
interface PunchPlaces {
  readonly earlier: number;
  readonly take: number;
  /** The place of the take's recording, where the take is converted from it. */
  readonly recording: number | undefined;
}

/** Where a punch of `length` frames reads its take: its recording `from` a frame, by `places`. */
interface TakeReading {
  readonly media: PlanSource;
  readonly from: number;
  readonly length: number;
  readonly places: PunchPlaces;
}

/** The take's stream: the take at the reader's `rate`, faded in and out at the crossfades. */
function takeStream(
  read: TakeReading,
  reader: Pick<PlanStream, 'sampleRate' | 'layout'>,
  punch: PunchRange,
): PlanStream {
  const { media, from, length, places } = read;
  const source =
    places.recording === undefined
      ? reading(media, from, length)
      : reading({ kind: 'stream', stream: places.recording }, 0, length);
  const count = channelCount(reader.layout);
  return {
    sampleRate: reader.sampleRate,
    layout: reader.layout,
    segments: crossed([source], length, punch, count, [FadeDirection.In, FadeDirection.Out]),
  };
}

/**
 * The earlier audio's stream: what `stream` had over `range` at each
 * boundary, faded out into the take and in from it, with silence between
 * that nothing reads.
 */
function earlierStream(stream: PlanStream, range: EditRange, punch: PunchRange): PlanStream {
  const fade = punch.crossfade.length;
  const length = range.end - range.start;
  const between = length - 2 * fade;
  const count = channelCount(stream.layout);
  const segments = [
    ...sliceSegments(stream.segments, range.start, range.start + fade),
    ...(between > 0 ? [reading({ kind: 'silence', channels: count }, 0, between)] : []),
    ...sliceSegments(stream.segments, range.end - fade, range.end),
  ];
  return {
    sampleRate: stream.sampleRate,
    layout: stream.layout,
    segments: crossed(segments, length, punch, count, [FadeDirection.Out, FadeDirection.In]),
  };
}

/** The segments that read the punch in its range's place: the crossings mixed, the take between. */
function punchedSegments(length: number, fade: number, places: PunchPlaces): PlanSegment[] {
  const mixed: PlanSource = { kind: 'mix', streams: [places.earlier, places.take] };
  const between = length - 2 * fade;
  return [
    ...(fade > 0 ? [reading(mixed, 0, fade)] : []),
    ...(between > 0 ? [reading({ kind: 'stream', stream: places.take }, fade, between)] : []),
    ...(fade > 0 ? [reading(mixed, length - fade, fade)] : []),
  ];
}

/** What a punch reads: its stack's range, the chosen take, and the take's recording. */
interface ChosenRecording {
  readonly punch: PunchRange;
  readonly take: Take;
  readonly recorded: MediaShape;
}

/**
 * The chosen take of the stack `edit` names, with its recording, or
 * `undefined` where the stack has none chosen; or why the project lacks what
 * the edit names.
 */
function chosenRecording(
  edit: PunchEdit,
  context: PlanContext,
): DomainResult<ChosenRecording | undefined> {
  const stack = context.takeStacks.get(edit.stack);
  if (stack?.punch === undefined) {
    return missing(
      'take-stack-missing',
      'The audio is punched from a take stack the project does not have.',
      { stack: edit.stack },
    );
  }
  const take = chosenTake(stack);
  if (take === undefined) return succeed(undefined);
  const recorded = context.assets.get(take.asset);
  if (recorded === undefined) {
    return missing('take-missing', 'The chosen take is a recording the project does not have.', {
      asset: take.asset,
    });
  }
  return succeed({ punch: stack.punch, take, recorded });
}

/**
 * Where the punch's new streams are placed: 1 on, in the order they are read,
 * the earlier audio where there is a crossfade, the take, and its recording
 * where the take is converted from it.
 */
function punchPlaces(fade: number, converted: boolean): PunchPlaces {
  return {
    earlier: 1,
    take: fade > 0 ? 2 : 1,
    recording: converted ? (fade > 0 ? 3 : 2) : undefined,
  };
}

/**
 * The stream of the take's recording at its own rate, which the take's stream
 * reads converted, where the take is at another rate than `rate`; else none.
 */
function recordingStreams(
  read: TakeReading,
  recorded: MediaShape,
  rate: number,
): readonly PlanStream[] {
  if (read.places.recording === undefined) return [];
  const frames = punchTakeFrames(read.length, rate, recorded.sampleRate);
  return [
    {
      sampleRate: recorded.sampleRate,
      layout: recorded.channelLayout,
      segments: [reading(read.media, read.from, frames)],
    },
  ];
}

/** The folding with its first stream's `range` replaced by the take `edit`'s stack has chosen. */
export function punchRange(
  folding: Folding,
  range: EditRange,
  edit: PunchEdit,
  context: PlanContext,
): DomainResult<Folding> {
  const chosen = chosenRecording(edit, context);
  if (!chosen.ok) return chosen;
  if (chosen.value === undefined) return succeed(folding);
  const { punch, take, recorded } = chosen.value;
  const rate = folding.stream.sampleRate;
  const converted = recorded.sampleRate !== rate;
  if (converted) {
    const known = versionKnown('resampler', punch.resampler, context.engine.resampler);
    if (!known.ok) return known;
  }
  const fade = punch.crossfade.length;
  const length = range.end - range.start;
  const places = punchPlaces(fade, converted);
  const [stream, ...others] = shiftStreams(
    [folding.stream, ...folding.others],
    places.recording ?? places.take,
  );
  const media: PlanSource = { kind: 'media', asset: take.asset };
  const read: TakeReading = { media, from: punch.preRoll + take.compensation, length, places };
  return succeed({
    stream: {
      ...stream,
      segments: [
        ...sliceSegments(stream.segments, 0, range.start),
        ...punchedSegments(length, fade, places),
        ...sliceSegments(stream.segments, range.end, lengthOf(stream.segments)),
      ],
    },
    others: [
      ...(fade > 0 ? [earlierStream(stream, range, punch)] : []),
      takeStream(read, stream, punch),
      ...recordingStreams(read, recorded, rate),
      ...others,
    ],
  });
}
