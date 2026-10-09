/**
 * The messages between a reader of edited sound in one worker and the cached
 * preview producer in the preview worker (ADR-0061).
 *
 * A worker that reads edited sound, the feeder, the peak worker or the
 * detection worker, is given a port to the preview worker, and opens the
 * renders it reads by naming the stream, its plan and its files, as it would
 * read them itself; it reads frames by asking for them, and the frames come
 * back transferred, so no render is copied whole across a thread. One
 * discriminated union each way, each message read field by field on arrival,
 * since a structured clone may carry anything a sender put in it.
 */

import {
  countAt,
  editPlanOf,
  oneOf,
  optionalFailureSummaryAt,
  failureSummaryAt,
  optionalTextAt,
  qualityModeAt,
  readMessage,
  sampleArraysAt,
  type DomainResult,
  type EditPlan,
  type FailureSummary,
  type MessageFields,
  type QualityMode,
} from '@audiogubbins/domain';

import { mediaEntriesOf } from '../pcm/pcm-description.js';
import type { MediaEntry } from '../pcm/plan-content.js';

/** The kinds of message a reader sends the preview worker. */
export const ToPreviewKind = {
  Open: 'open',
  Read: 'read',
  Cancel: 'cancel',
  Close: 'close',
} as const;

/** A message a reader sends the preview worker. */
export type ToPreview =
  | {
      /** Opens the render of a plan's stream as `stream`, its name on this port. */
      readonly kind: typeof ToPreviewKind.Open;
      readonly stream: number;
      readonly plan: EditPlan;
      readonly place: number;
      readonly media: readonly MediaEntry[];
      readonly quality: QualityMode;
      readonly reason: string | undefined;
    }
  | {
      /** Asks for `frames` frames of `stream`'s `channels` channels from `start`, answered as `read`. */
      readonly kind: typeof ToPreviewKind.Read;
      readonly stream: number;
      readonly read: number;
      readonly start: number;
      readonly frames: number;
      readonly channels: number;
    }
  | {
      /** Stops waiting for read `read`, whose reader was cancelled. */
      readonly kind: typeof ToPreviewKind.Cancel;
      readonly read: number;
    }
  | {
      /** Lets `stream` go. */
      readonly kind: typeof ToPreviewKind.Close;
      readonly stream: number;
    };

/** The kinds of message the preview worker sends a reader. */
export const FromPreviewKind = {
  Ready: 'ready',
  Samples: 'samples',
  ReadFailed: 'read-failed',
} as const;

/** A message the preview worker sends a reader. */
export type FromPreview =
  | {
      /** Whether `stream`'s render is kept, or why the cache declined it. */
      readonly kind: typeof FromPreviewKind.Ready;
      readonly stream: number;
      readonly declined: FailureSummary | undefined;
    }
  | {
      /** The frames read `read` asked for, one array per channel, transferred. */
      readonly kind: typeof FromPreviewKind.Samples;
      readonly read: number;
      readonly channels: readonly Float32Array[];
    }
  | {
      /** Why read `read` could not be answered. */
      readonly kind: typeof FromPreviewKind.ReadFailed;
      readonly read: number;
      readonly failure: FailureSummary;
    };

function toPreviewFrom(fields: MessageFields): ToPreview {
  const kind = oneOf(fields, 'kind', ToPreviewKind);
  switch (kind) {
    case ToPreviewKind.Open:
      return {
        kind,
        stream: countAt(fields, 'stream'),
        plan: editPlanOf(fields['plan'], 'plan'),
        place: countAt(fields, 'place'),
        media: mediaEntriesOf(fields['media'], 'media'),
        quality: qualityModeAt(fields, 'quality'),
        reason: optionalTextAt(fields, 'reason'),
      };
    case ToPreviewKind.Read:
      return {
        kind,
        stream: countAt(fields, 'stream'),
        read: countAt(fields, 'read'),
        start: countAt(fields, 'start'),
        frames: countAt(fields, 'frames'),
        channels: countAt(fields, 'channels'),
      };
    case ToPreviewKind.Cancel:
      return { kind, read: countAt(fields, 'read') };
    case ToPreviewKind.Close:
      return { kind, stream: countAt(fields, 'stream') };
  }
}

function fromPreviewFrom(fields: MessageFields): FromPreview {
  const kind = oneOf(fields, 'kind', FromPreviewKind);
  switch (kind) {
    case FromPreviewKind.Ready:
      return {
        kind,
        stream: countAt(fields, 'stream'),
        declined: optionalFailureSummaryAt(fields, 'declined'),
      };
    case FromPreviewKind.Samples:
      return { kind, read: countAt(fields, 'read'), channels: sampleArraysAt(fields, 'channels') };
    case FromPreviewKind.ReadFailed:
      return { kind, read: countAt(fields, 'read'), failure: failureSummaryAt(fields, 'failure') };
  }
}

/** A message the preview worker received, read, or why it cannot be. */
export function readToPreview(value: unknown): DomainResult<ToPreview> {
  return readMessage(value, 'preview.message-malformed', toPreviewFrom);
}

/** A message a reader received from the preview worker, read, or why it cannot be. */
export function readFromPreview(value: unknown): DomainResult<FromPreview> {
  return readMessage(value, 'preview.reply-malformed', fromPreviewFrom);
}
