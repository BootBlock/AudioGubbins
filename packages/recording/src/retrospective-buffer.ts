/**
 * The retrospective buffer's setting and arithmetic (`REQ-REC-090`, ADR-0070).
 *
 * While an input is armed with the buffer on, the capture worklet keeps the
 * last few seconds in its own memory, and nothing of it is written until the
 * person records: then the interval becomes the take's first frames. This is
 * the setting the person chooses, how much of it the memory the page has left
 * allows, and how much of what the worklet holds a take begins with.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

/** The shortest interval the buffer keeps: enough for a phrase begun before Record. */
export const MINIMUM_RETROSPECTIVE_SECONDS = 5;

/**
 * The longest interval the buffer keeps. Its memory grows with the interval,
 * the rate and the channel count, and a minute is tens of mebibytes at studio
 * rates, kept for as long as the input is armed.
 */
export const MAXIMUM_RETROSPECTIVE_SECONDS = 60;

/** The bytes one sample takes in the buffer, which holds 32-bit floats. */
const BYTES_PER_SAMPLE = 4;

/** Whether the buffer is kept while armed, and for how long. */
export type RetrospectiveSetting =
  { readonly on: false } | { readonly on: true; readonly seconds: number };

/** The buffer off: the default, since keeping sound before Record is the person's choice. */
export const RETROSPECTIVE_OFF: RetrospectiveSetting = { on: false };

/** The buffer on for `seconds`, or why that interval is refused. */
export function retrospectiveOn(seconds: number): DomainResult<RetrospectiveSetting> {
  if (
    !Number.isFinite(seconds) ||
    seconds < MINIMUM_RETROSPECTIVE_SECONDS ||
    seconds > MAXIMUM_RETROSPECTIVE_SECONDS
  ) {
    return fail(
      failure(
        'recording.retrospective-out-of-range',
        FailureKind.Rejected,
        `The retrospective buffer keeps between ${String(MINIMUM_RETROSPECTIVE_SECONDS)} and ${String(MAXIMUM_RETROSPECTIVE_SECONDS)} seconds.`,
        { details: { seconds: String(seconds) } },
      ),
    );
  }
  return succeed({ on: true, seconds });
}

/** The frames a buffer of `seconds` holds at `rate`: a part of a frame is a whole one more. */
export function retrospectiveFrames(seconds: number, rate: SampleRate): SampleCount {
  return derivedSampleCount(Math.ceil(seconds * rate));
}

/** The bytes a buffer of `seconds` holds at `rate` over `channels` channels. */
function retrospectiveMemory(seconds: number, rate: SampleRate, channels: number): number {
  return retrospectiveFrames(seconds, rate) * channels * BYTES_PER_SAMPLE;
}

/**
 * The share of the memory the page says it has left that the buffer may take:
 * an eighth. The buffer is held for as long as the input is armed, which may
 * be the whole session, beside the take's own capture queue, the project's
 * decoded audio and the editor, so it takes half the quarter a one-off
 * allocation such as extracting a picture's sound may take.
 */
const RETROSPECTIVE_MEMORY_SHARE = 1 / 8;

/**
 * What of the buffer's setting the memory the page has left allows
 * (`REQ-REC-090`): the whole of it; a shorter interval, in whole seconds, where
 * the whole would take more than its share; or none, where not even the
 * shortest interval would fit. `bytes` is what the interval asked for takes.
 */
export type RetrospectiveFit =
  | { readonly kind: 'whole'; readonly seconds: number }
  | {
      readonly kind: 'shortened';
      readonly seconds: number;
      readonly asked: number;
      readonly bytes: number;
      readonly allowed: number;
    }
  | {
      readonly kind: 'none';
      readonly asked: number;
      readonly bytes: number;
      readonly allowed: number;
    };

/**
 * How much of a buffer of `seconds` may be kept at `rate` over `channels`
 * channels, given `availableBytes`, the memory the page says it has left.
 * Where the browser says nothing, nothing is assumed and the whole interval
 * is kept: the setting's own maximum already bounds it.
 */
export function retrospectiveFit(
  seconds: number,
  rate: SampleRate,
  channels: number,
  availableBytes: number | undefined,
): RetrospectiveFit {
  if (availableBytes === undefined) return { kind: 'whole', seconds };
  const bytes = retrospectiveMemory(seconds, rate, channels);
  const allowed = Math.floor(availableBytes * RETROSPECTIVE_MEMORY_SHARE);
  if (bytes <= allowed) return { kind: 'whole', seconds };
  const fitting = Math.floor(allowed / (rate * channels * BYTES_PER_SAMPLE));
  return fitting < MINIMUM_RETROSPECTIVE_SECONDS
    ? { kind: 'none', asked: seconds, bytes, allowed }
    : { kind: 'shortened', seconds: fitting, asked: seconds, bytes, allowed };
}

/** Where a take begins on the media clock, and how many of its first frames came from the buffer. */
export interface RetrospectiveStart {
  /** The media clock's frame of the take's first frame. */
  readonly firstFrame: SampleCount;

  /** The frames before Record the take begins with. */
  readonly frames: SampleCount;
}

/**
 * Where a take recorded at clock frame `at` begins, given the frames the
 * worklet holds when Record is pressed and the buffer's capacity.
 *
 * The take begins with every frame the worklet holds, up to the capacity: a
 * buffer armed for less time than its interval holds less than its capacity,
 * and those are all there are. Nothing is held from before the clock began, so
 * the take never begins before frame zero.
 */
export function retrospectiveStart(
  setting: RetrospectiveSetting,
  rate: SampleRate,
  held: SampleCount,
  at: SampleCount,
): RetrospectiveStart {
  const capacity = setting.on ? retrospectiveFrames(setting.seconds, rate) : 0;
  const frames = Math.min(capacity, held, at);
  return { firstFrame: derivedSampleCount(at - frames), frames: derivedSampleCount(frames) };
}
