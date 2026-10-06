/**
 * The messages between the page and the detection worker.
 *
 * Each direction is one discriminated union, and each message is read field
 * by field on arrival (`detection-message-reading.ts`), so a malformed one is
 * refused with the field that was wrong rather than acted on. A job is one
 * detection, named by the page; a target is what it analyses, an asset or a
 * region, of which the worker runs one detection at a time: a request for a
 * target cancels the one before it.
 */

import type { EditRange, QualityMode } from '@audiogubbins/domain';
import type { PcmDescription } from '@audiogubbins/audio-engine';

import type { DetectionResult } from './detection-result.js';

/** What the page asks of the worker. */
export const ToDetectionWorkerKind = {
  /** Read a range of a source, run the assistants' detectors over it, and answer. */
  Detect: 'detect',
  /** Stop a detection, queued or running, and answer nothing more for it. */
  Cancel: 'cancel',
} as const;

/** A detection the page asks for. */
export interface DetectRequest {
  readonly kind: typeof ToDetectionWorkerKind.Detect;
  readonly job: string;
  /** What it analyses, one detection at a time. */
  readonly target: string;
  readonly channels: number;
  /** The audio, described as the render and the peaks describe it. */
  readonly description: PcmDescription;
  /** The quality an edited sound's chains run at: the final render's (ADR-0061). */
  readonly quality: QualityMode;
  /** The frames of the source to read. */
  readonly range: EditRange;
  /** The keys of the assistants to run, in the order their reports are answered. */
  readonly assistants: readonly string[];
}

export type ToDetectionWorker =
  DetectRequest | { readonly kind: typeof ToDetectionWorkerKind.Cancel; readonly job: string };

/** What the worker tells the page. */
export const FromDetectionWorkerKind = {
  /** How far a detection has read. */
  Progress: 'progress',
  Done: 'done',
  /** The detection cannot be made, and why. */
  Failed: 'failed',
  Cancelled: 'cancelled',
  /** A message the worker could not read, which names no job it can answer. */
  Refused: 'refused',
} as const;

export type FromDetectionWorker =
  | {
      readonly kind: typeof FromDetectionWorkerKind.Progress;
      readonly job: string;
      readonly framesRead: number;
      readonly framesTotal: number;
    }
  | {
      readonly kind: typeof FromDetectionWorkerKind.Done;
      readonly job: string;
      readonly result: DetectionResult;
    }
  | {
      readonly kind: typeof FromDetectionWorkerKind.Failed;
      readonly job: string;
      readonly reason: string;
    }
  | { readonly kind: typeof FromDetectionWorkerKind.Cancelled; readonly job: string }
  | { readonly kind: typeof FromDetectionWorkerKind.Refused; readonly reason: string };
