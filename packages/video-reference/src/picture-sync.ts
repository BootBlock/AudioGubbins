/**
 * Keeping the picture with the audio: what to do, given where the audio is and
 * what the video element presents (ADR-0046).
 *
 * Both rules compare frames, never times: the frame the element presents
 * against the frame that holds the audible position. While the transport plays,
 * a picture more than one frame from that frame is sought to the position;
 * within a frame it is left alone, because a seek interrupts playback for
 * longer than a frame's drift is visible. While the transport is parked or
 * scrubbed, the picture must show exactly the frame the position falls in, so
 * any other frame is sought. Before the picture's first frame or after its
 * last, there is no picture to show.
 */

import { framesPerSecond } from '@audiogubbins/timeline';

import {
  pictureFrameAt,
  pictureTimeAt,
  seekTimeFor,
  type ReferenceMediaClockBinding,
} from './clock-binding.js';

/** What the video element should do. */
export type PictureCorrection =
  | { readonly kind: 'in-sync' }
  | { readonly kind: 'seek'; readonly to: number }
  | { readonly kind: 'no-picture' };

/** What the picture is doing, as the video element reports it. */
export interface PresentedPicture {
  /**
   * The media time reported, in seconds: the presented frame's own timestamp
   * where the browser's frame callback gives it, or else the element's current
   * time, which lies somewhere within that frame.
   */
  readonly mediaTime: number;
  /** Whether `mediaTime` is the presented frame's timestamp rather than a time within it. */
  readonly stamped: boolean;
  /** How long the picture lasts, in seconds. */
  readonly duration: number;
}

/** Whether the transport is playing, or parked where the person put it. */
export type TransportMotion = 'playing' | 'parked';

/**
 * The picture's frame the element presents, counted from its first.
 *
 * A frame's timestamp is its start as the container stored it, and WebM and
 * most MP4 files store whole milliseconds, so at 30 or 29.97 frames a second a
 * third of the frames are stamped a little before they start. The frame whose
 * start is nearest the timestamp is the one presented, which holds for any
 * rounding short of half a frame. An element's current time is not a start but
 * a moment within the frame, as far on as its end, so the frame holding it is
 * the one presented.
 */
function presentedFrame(binding: ReferenceMediaClockBinding, presented: PresentedPicture): number {
  const frames = presented.mediaTime * framesPerSecond(binding.frames);
  return presented.stamped ? Math.round(frames) : Math.floor(frames + 1e-6);
}

/**
 * How many frames the picture is from the frame that holds `position`; positive
 * when it is late.
 */
export function pictureDrift(
  binding: ReferenceMediaClockBinding,
  position: number,
  presented: PresentedPicture,
): number {
  return pictureFrameAt(binding, position) - presentedFrame(binding, presented);
}

/** What the video element should do to show the picture at the audible `position`. */
export function pictureCorrection(
  binding: ReferenceMediaClockBinding,
  position: number,
  presented: PresentedPicture,
  motion: TransportMotion,
): PictureCorrection {
  const expected = pictureTimeAt(binding, position);
  if (expected < 0 || expected >= presented.duration) return { kind: 'no-picture' };
  const drift = pictureDrift(binding, position, presented);
  if (motion === 'playing') {
    return Math.abs(drift) > 1 ? { kind: 'seek', to: expected } : { kind: 'in-sync' };
  }
  return drift === 0
    ? { kind: 'in-sync' }
    : { kind: 'seek', to: seekTimeFor(binding, pictureFrameAt(binding, position)) };
}
