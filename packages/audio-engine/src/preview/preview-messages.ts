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
  FailureKind,
  editPlanFrom,
  fail,
  failure,
  qualityModeFrom,
  succeed,
  type DomainResult,
  type EditPlan,
  type QualitySettings,
} from '@audiogubbins/domain';

import { mediaEntryFrom } from '../pcm/pcm-description.js';
import type { MediaEntry } from '../pcm/plan-content.js';

/** A failure as it crosses a thread: its code and its summary, which a clone can carry. */
export interface CrossedFailure {
  readonly code: string;
  readonly summary: string;
}

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
      readonly quality: QualitySettings;
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
      readonly declined: CrossedFailure | undefined;
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
      readonly failure: CrossedFailure;
    };

type Fields = Readonly<Record<string, unknown>>;

/** Why a message could not be read, thrown inside a reader and caught by {@link readWith}. */
class Unreadable extends Error {}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldsOf(value: unknown): Fields {
  if (!isFields(value)) throw new Unreadable('it is not an object with named fields');
  return value;
}

function countAt(fields: Fields, name: string): number {
  const value = fields[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Unreadable(`its ${name} is not a whole number of at least zero`);
  }
  return value;
}

function textAt(fields: Fields, name: string): string {
  const value = fields[name];
  if (typeof value !== 'string') throw new Unreadable(`its ${name} is not text`);
  return value;
}

function optionalTextAt(fields: Fields, name: string): string | undefined {
  return fields[name] === undefined ? undefined : textAt(fields, name);
}

function failureAt(fields: Fields, name: string): CrossedFailure {
  const crossed = fieldsOf(fields[name]);
  return { code: textAt(crossed, 'code'), summary: textAt(crossed, 'summary') };
}

function optionalFailureAt(fields: Fields, name: string): CrossedFailure | undefined {
  return fields[name] === undefined ? undefined : failureAt(fields, name);
}

/** Whether a value is a `Float32Array`, by its tag, as a clone is made in the receiving realm. */
function isSamples(value: unknown): value is Float32Array {
  return Object.prototype.toString.call(value) === '[object Float32Array]';
}

function samplesAt(fields: Fields, name: string): readonly Float32Array[] {
  const value = fields[name];
  if (!Array.isArray(value) || !value.every(isSamples)) {
    throw new Unreadable(`its ${name} is not a list of sample arrays`);
  }
  return value;
}

function planAt(fields: Fields): EditPlan {
  const plan = editPlanFrom(fields['plan']);
  if (!plan.ok) throw new Unreadable(`its plan is not an edit plan (${plan.failures[0].summary})`);
  return plan.value;
}

function mediaAt(fields: Fields): readonly MediaEntry[] {
  const listed = fields['media'];
  const media = Array.isArray(listed) ? listed.map(mediaEntryFrom) : [undefined];
  if (!media.every((entry) => entry !== undefined)) {
    throw new Unreadable('its media is not a list of the files a plan reads');
  }
  return media;
}

function qualityAt(fields: Fields): QualitySettings {
  const mode = qualityModeFrom(fields['quality']);
  if (!mode.ok) throw new Unreadable('its quality is not one a level offers');
  return mode.value.settings;
}

function kindAt<TKind extends string>(
  fields: Fields,
  kinds: Readonly<Record<string, TKind>>,
): TKind {
  const kind = Object.values(kinds).find((one) => one === fields['kind']);
  if (kind === undefined) throw new Unreadable('its kind is not one this protocol has');
  return kind;
}

function toPreviewFrom(value: unknown): ToPreview {
  const fields = fieldsOf(value);
  const kind = kindAt(fields, ToPreviewKind);
  switch (kind) {
    case ToPreviewKind.Open:
      return {
        kind,
        stream: countAt(fields, 'stream'),
        plan: planAt(fields),
        place: countAt(fields, 'place'),
        media: mediaAt(fields),
        quality: qualityAt(fields),
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

function fromPreviewFrom(value: unknown): FromPreview {
  const fields = fieldsOf(value);
  const kind = kindAt(fields, FromPreviewKind);
  switch (kind) {
    case FromPreviewKind.Ready:
      return {
        kind,
        stream: countAt(fields, 'stream'),
        declined: optionalFailureAt(fields, 'declined'),
      };
    case FromPreviewKind.Samples:
      return { kind, read: countAt(fields, 'read'), channels: samplesAt(fields, 'channels') };
    case FromPreviewKind.ReadFailed:
      return { kind, read: countAt(fields, 'read'), failure: failureAt(fields, 'failure') };
  }
}

function readWith<T>(value: unknown, code: string, read: (value: unknown) => T): DomainResult<T> {
  try {
    return succeed(read(value));
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    return fail(
      failure(code, FailureKind.Rejected, `A preview message could not be read: ${error.message}.`),
    );
  }
}

/** A message the preview worker received, read, or why it cannot be. */
export function readToPreview(value: unknown): DomainResult<ToPreview> {
  return readWith(value, 'preview.message-malformed', toPreviewFrom);
}

/** A message a reader received from the preview worker, read, or why it cannot be. */
export function readFromPreview(value: unknown): DomainResult<FromPreview> {
  return readWith(value, 'preview.reply-malformed', fromPreviewFrom);
}
