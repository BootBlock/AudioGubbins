/**
 * SMPTE timecode labels for frame numbers.
 *
 * Non-drop timecode counts each frame as the nominal rate's; drop-frame skips
 * the labels `00` and `01` (at 29.97, and `00` to `03` at 59.94) of the first
 * second of every minute that is not a tenth minute, so the label keeps pace
 * with the clock. Its frames are written after a semicolon, so a person can
 * tell the two apart at a glance.
 */

import { nominalFramesPerSecond, type FrameRate } from './frame-rate.js';

/** The label a frame is written with: hours, minutes, seconds and frames. */
export interface TimecodeLabel {
  readonly negative: boolean;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly frames: number;
  readonly dropFrame: boolean;
}

/** The frame count a drop-frame label shows for a real frame count. */
function droppedLabelCount(frame: number, perSecond: number): number {
  const dropped = perSecond === 60 ? 4 : 2;
  const perMinute = perSecond * 60 - dropped;
  const perTenMinutes = perMinute * 10 + dropped;
  const tens = Math.floor(frame / perTenMinutes);
  const within = frame % perTenMinutes;
  const minutes = within > dropped ? Math.floor((within - dropped) / perMinute) : 0;
  return frame + dropped * 9 * tens + dropped * minutes;
}

/** The timecode label of frame `frame`, counted from frame zero at `00:00:00:00`. */
export function timecodeOf(frame: number, frames: FrameRate): TimecodeLabel {
  const perSecond = nominalFramesPerSecond(frames);
  const magnitude = Math.abs(frame);
  const counted = frames.dropFrame ? droppedLabelCount(magnitude, perSecond) : magnitude;
  const totalSeconds = Math.floor(counted / perSecond);
  return {
    negative: frame < 0,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
    frames: counted % perSecond,
    dropFrame: frames.dropFrame,
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A label as it is written: `01:02:03:04`, or `01:02:03;04` for drop-frame,
 * with the typographic minus before a frame ahead of the picture's first.
 */
export function timecodeText(label: TimecodeLabel): string {
  const sign = label.negative ? '−' : '';
  const separator = label.dropFrame ? ';' : ':';
  return `${sign}${twoDigits(label.hours)}:${twoDigits(label.minutes)}:${twoDigits(label.seconds)}${separator}${twoDigits(label.frames)}`;
}
