/**
 * Keeping the picture with the audio: what to do, given where the audio is and
 * what the video element presents (ADR-0046).
 *
 * The tolerance is one frame period. While the transport plays, a picture that
 * has drifted more than a frame from the audible position is sought to it;
 * within a frame it is left alone, because a seek interrupts playback for
 * longer than a frame's drift is visible. While the transport is parked or
 * scrubbed, the picture must show exactly the frame the position falls in, so
 * any other frame is sought. Before the picture's first frame or after its
 * last, there is no picture to show.
 */

import {
  framePeriod,
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
  /** The media time of the frame presented, in seconds; the frame callback's where the browser has one. */
  readonly mediaTime: number;
  /** How long the picture lasts, in seconds. */
  readonly duration: number;
}

/** Whether the transport is playing, or parked where the person put it. */
export type TransportMotion = 'playing' | 'parked';

/** What the video element should do to show the picture at the audible `position`. */
export function pictureCorrection(
  binding: ReferenceMediaClockBinding,
  position: number,
  presented: PresentedPicture,
  motion: TransportMotion,
): PictureCorrection {
  const expected = pictureTimeAt(binding, position);
  if (expected < 0 || expected >= presented.duration) return { kind: 'no-picture' };
  if (motion === 'playing') {
    const drift = Math.abs(presented.mediaTime - expected);
    return drift > framePeriod(binding) ? { kind: 'seek', to: expected } : { kind: 'in-sync' };
  }
  const wanted = pictureFrameAt(binding, position);
  const shown = Math.floor(presented.mediaTime / framePeriod(binding) + 1e-6);
  return shown === wanted
    ? { kind: 'in-sync' }
    : { kind: 'seek', to: seekTimeFor(binding, wanted) };
}

/** How far, in seconds, the picture is from where it should be; positive when it is late. */
export function pictureDrift(
  binding: ReferenceMediaClockBinding,
  position: number,
  presented: PresentedPicture,
): number {
  return pictureTimeAt(binding, position) - presented.mediaTime;
}
