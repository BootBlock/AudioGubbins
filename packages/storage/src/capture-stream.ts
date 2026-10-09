/**
 * The port a recording's audio reaches the storage through (ADR-0071): the
 * dry input's frames in order, every run of frames lost on the way, and the
 * end with why capture ended.
 *
 * The storage knows no capture channel and no `MessagePort`: the storage
 * worker reads the channel the capture worklet writes and gives the storage
 * what it read through this port, so every rule of keeping a recording is
 * tested with a stream made in a test. Frames are counted from the
 * recording's first, which is frame 0.
 */

import type { RecordingEnding } from '@audiogubbins/project-format';

/** What a recording's stream brings, in order. */
export type CapturedEvent =
  | {
      /** The recording's frames from `frame` on, one array per channel, of one length. */
      readonly kind: 'block';
      readonly frame: number;
      readonly channels: readonly Float32Array[];
    }
  | {
      /** `frames` frames from `frame` on were captured and lost before they could be kept. */
      readonly kind: 'gap';
      readonly frame: number;
      readonly frames: number;
    }
  | {
      /** Capture ended, for `ending`, where `problem` says more of a failure. */
      readonly kind: 'end';
      readonly ending: RecordingEnding;
      readonly problem?: string;
    };

/** A recording's audio, as it arrives. */
export interface CaptureStream {
  /** The next event, waiting for it; nothing once the end has been read or the stream closed. */
  next(): Promise<CapturedEvent | undefined>;

  /** Stops reading; a read waiting answers nothing, and nothing more arrives. */
  close(): void;
}
