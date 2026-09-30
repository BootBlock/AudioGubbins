/**
 * Reference picture bound to the shared media clock (ADR-0046).
 *
 * Picture follows the transport, never the reverse: the binding says, for a
 * boundary of the timeline, what time of the picture shows and which of its
 * frames that is. The picture's first frame shows at the binding's offset,
 * which the person calibrates, and may be before the timeline's start. Its
 * frames are counted at the frame-rate interpretation the person chose, which
 * changes how frames are numbered and labelled, never how fast the picture
 * plays. Frame arithmetic is exact (`frameAt`, `frameStart`), so a frame's
 * boundary is the same at the fourth hour as at the first; a time in seconds is
 * only ever computed to hand to a video element.
 */

import type { SampleRate } from '@audiogubbins/domain';
import {
  frameAt,
  frameStart,
  framesPerSecond,
  timecodeOf,
  timecodeText,
  type FrameRate,
} from '@audiogubbins/timeline';

/** How the picture's time relates to the timeline's. */
export interface ReferenceMediaClockBinding {
  /** The timeline's sample rate, which positions are counted in. */
  readonly timelineRate: SampleRate;
  /** The frame rate the picture is counted at. */
  readonly frames: FrameRate;
  /** The timeline boundary at which the picture's first frame shows; negative before the start. */
  readonly offset: number;
  /** The frame number the picture's first frame is labelled, as a source that starts at `01:00:00:00` is. */
  readonly firstFrameLabel: number;
}

/** A binding with the picture's first frame at the timeline's start, labelled zero. */
export function bindingAtStart(
  timelineRate: SampleRate,
  frames: FrameRate,
): ReferenceMediaClockBinding {
  return { timelineRate, frames, offset: 0, firstFrameLabel: 0 };
}

/** The picture's frame showing at `position`; negative before its first frame. */
export function pictureFrameAt(binding: ReferenceMediaClockBinding, position: number): number {
  return frameAt(position - binding.offset, binding.timelineRate, binding.frames);
}

/** The timeline boundary where the picture's frame `frame` starts. */
export function frameBoundary(binding: ReferenceMediaClockBinding, frame: number): number {
  return binding.offset + frameStart(frame, binding.timelineRate, binding.frames);
}

/** The picture's time at `position`, in seconds from its first frame, for a video element. */
export function pictureTimeAt(binding: ReferenceMediaClockBinding, position: number): number {
  return (position - binding.offset) / binding.timelineRate;
}

/**
 * The time to seek a video element to for it to show frame `frame`: the middle
 * of the frame, so a browser's rounding of a seek to its nearest presentation
 * time lands on the frame and not on the edge of its neighbour.
 */
export function seekTimeFor(binding: ReferenceMediaClockBinding, frame: number): number {
  return (frame + 0.5) / framesPerSecond(binding.frames);
}

/** The timecode label of the picture at `position`, counted from its first frame's label. */
export function pictureTimecodeAt(binding: ReferenceMediaClockBinding, position: number): string {
  return timecodeText(
    timecodeOf(pictureFrameAt(binding, position) + binding.firstFrameLabel, binding.frames),
  );
}

/**
 * The binding calibrated so the picture's frame `frame` starts at `position`:
 * what "align this frame with the playhead" does.
 */
export function calibratedTo(
  binding: ReferenceMediaClockBinding,
  frame: number,
  position: number,
): ReferenceMediaClockBinding {
  return { ...binding, offset: position - frameStart(frame, binding.timelineRate, binding.frames) };
}

/**
 * The binding with the picture moved by `frames` whole frames, later for a
 * positive count, keeping its offset a whole number of samples.
 */
export function nudgedByFrames(
  binding: ReferenceMediaClockBinding,
  frames: number,
): ReferenceMediaClockBinding {
  return {
    ...binding,
    offset: binding.offset + frameStart(frames, binding.timelineRate, binding.frames),
  };
}

/**
 * The boundaries where picture frames start within `[from, to]`, for frame
 * snapping and the picture ruler, at most `most` of them.
 */
export function frameBoundariesWithin(
  binding: ReferenceMediaClockBinding,
  from: number,
  to: number,
  most: number,
): readonly number[] {
  const boundaries: number[] = [];
  const first = pictureFrameAt(binding, from);
  for (let frame = first; boundaries.length < most; frame += 1) {
    const boundary = frameBoundary(binding, frame);
    if (boundary > to) break;
    if (boundary >= from) boundaries.push(boundary);
  }
  return boundaries;
}
