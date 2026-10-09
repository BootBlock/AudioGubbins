/**
 * Reading a peak message that crossed a thread, field by field
 * (REQ-EXEC-136.12). A reader throws at the first wrong field, which the
 * protocol's `read` function turns into a failure naming it.
 */

import {
  Malformed,
  bytesAt,
  countAt,
  countsAt,
  fieldsOf,
  frameRangeAt,
  isTagged,
  itemsAt,
  itemsOf,
  optionalBytesAt,
  qualityModeAt,
  readMessage,
  sampleArraysAt,
  textAt,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';
import { isMessagePortLike, pcmDescription, type PcmDescription } from '@audiogubbins/audio-engine';

import {
  FromPeakWorkerKind,
  ToPeakWorkerKind,
  type FrameRange,
  type FromPeakWorker,
  type ToPeakWorker,
} from './peak-messages.js';
import type { PeakChannel, PeakRun } from './peak-pyramid.js';

function optionalRangeAt(fields: MessageFields, field: string): FrameRange | undefined {
  return fields[field] === undefined ? undefined : frameRangeAt(fields, field);
}

/** Whether a value is a typed array of a class, by its tag, as a clone is made. */
const isInt16 = (value: unknown): value is Int16Array => isTagged(value, 'Int16Array');
const isUint8 = (value: unknown): value is Uint8Array => isTagged(value, 'Uint8Array');

function arrayOf<T>(value: unknown, field: string, is: (one: unknown) => one is T): T {
  if (!is(value)) throw new Malformed(field, 'a typed array of the kind the protocol names');
  return value;
}

function channelOf(value: unknown, field: string): PeakChannel {
  const fields = fieldsOf(value, field);
  const channel = {
    minimum: arrayOf(fields['minimum'], `${field}.minimum`, isInt16),
    maximum: arrayOf(fields['maximum'], `${field}.maximum`, isInt16),
    rms: arrayOf(fields['rms'], `${field}.rms`, isInt16),
    clipped: arrayOf(fields['clipped'], `${field}.clipped`, isUint8),
  };
  const length = channel.minimum.length;
  if ([channel.maximum, channel.rms, channel.clipped].some((one) => one.length !== length)) {
    throw new Malformed(field, 'arrays of one length');
  }
  return channel;
}

function runOf(value: unknown, field: string): PeakRun {
  const fields = fieldsOf(value, field);
  return {
    level: countAt(fields, 'level'),
    first: countAt(fields, 'first'),
    channels: itemsOf(fields['channels'], `${field}.channels`, channelOf),
  };
}

function descriptionAt(fields: MessageFields, field: string): PcmDescription {
  const read = pcmDescription(fields[field]);
  if (!read.ok) throw new Malformed(field, `a description of audio (${read.failures[0].summary})`);
  return read.value;
}

/** The port to the preview worker, the one message that names no job. */
function previewsFrom(fields: MessageFields): ToPeakWorker {
  const port = fields['port'];
  if (!isMessagePortLike(port)) throw new Malformed('port', 'the end of a message channel');
  return { kind: ToPeakWorkerKind.Previews, port };
}

function readToWorker(fields: MessageFields): ToPeakWorker {
  return fields['kind'] === ToPeakWorkerKind.Previews ? previewsFrom(fields) : readJob(fields);
}

/** A message about one job. */
function readJob(fields: MessageFields): ToPeakWorker {
  const job = textAt(fields, 'job');
  switch (fields['kind']) {
    case ToPeakWorkerKind.Open:
      return {
        kind: ToPeakWorkerKind.Open,
        job,
        identity: textAt(fields, 'identity'),
        revision: textAt(fields, 'revision'),
        channels: countAt(fields, 'channels'),
        description: descriptionAt(fields, 'description'),
        quality: qualityModeAt(fields, 'quality'),
        cached: optionalBytesAt(fields, 'cached'),
        focus: optionalRangeAt(fields, 'focus'),
      };
    case ToPeakWorkerKind.Focus:
      return { kind: ToPeakWorkerKind.Focus, job, range: frameRangeAt(fields, 'range') };
    case ToPeakWorkerKind.Samples:
      return {
        kind: ToPeakWorkerKind.Samples,
        job,
        request: countAt(fields, 'request'),
        range: frameRangeAt(fields, 'range'),
      };
    case ToPeakWorkerKind.Buckets:
      return {
        kind: ToPeakWorkerKind.Buckets,
        job,
        request: countAt(fields, 'request'),
        range: frameRangeAt(fields, 'range'),
      };
    case ToPeakWorkerKind.Cancel:
      return { kind: ToPeakWorkerKind.Cancel, job, request: countAt(fields, 'request') };
    case ToPeakWorkerKind.ZeroCrossing:
      return {
        kind: ToPeakWorkerKind.ZeroCrossing,
        job,
        request: countAt(fields, 'request'),
        position: countAt(fields, 'position'),
        within: countAt(fields, 'within'),
        channels: countsAt(fields, 'channels'),
      };
    case ToPeakWorkerKind.Close:
      return { kind: ToPeakWorkerKind.Close, job };
    default:
      throw new Malformed('kind', `one of ${Object.values(ToPeakWorkerKind).join(', ')}`);
  }
}

/** The worker's answer to a request of a view's. */
function readAnswer(fields: MessageFields, job: string): FromPeakWorker {
  switch (fields['kind']) {
    case FromPeakWorkerKind.Samples:
      return {
        kind: FromPeakWorkerKind.Samples,
        job,
        request: countAt(fields, 'request'),
        start: countAt(fields, 'start'),
        channels: sampleArraysAt(fields, 'channels'),
      };
    case FromPeakWorkerKind.Buckets:
      return {
        kind: FromPeakWorkerKind.Buckets,
        job,
        request: countAt(fields, 'request'),
        start: countAt(fields, 'start'),
        frames: countAt(fields, 'frames'),
        bucketFrames: countAt(fields, 'bucketFrames'),
        channels: itemsAt(fields, 'channels', channelOf),
      };
    case FromPeakWorkerKind.ZeroCrossing:
      return {
        kind: FromPeakWorkerKind.ZeroCrossing,
        job,
        request: countAt(fields, 'request'),
        position: fields['position'] === undefined ? undefined : countAt(fields, 'position'),
      };
    default:
      throw new Malformed('kind', 'an answer to a request');
  }
}

function readFromWorker(fields: MessageFields): FromPeakWorker {
  const job = textAt(fields, 'job');
  switch (fields['kind']) {
    case FromPeakWorkerKind.Adopted:
      return { kind: FromPeakWorkerKind.Adopted, job, bytes: bytesAt(fields, 'bytes') };
    case FromPeakWorkerKind.Runs:
      return { kind: FromPeakWorkerKind.Runs, job, runs: itemsAt(fields, 'runs', runOf) };
    case FromPeakWorkerKind.Complete: {
      const refusedCache = fields['refusedCache'];
      if (refusedCache !== undefined && typeof refusedCache !== 'string') {
        throw new Malformed('refusedCache', 'text');
      }
      return {
        kind: FromPeakWorkerKind.Complete,
        job,
        bytes: bytesAt(fields, 'bytes'),
        refusedCache,
      };
    }
    case FromPeakWorkerKind.Samples:
    case FromPeakWorkerKind.Buckets:
    case FromPeakWorkerKind.ZeroCrossing:
      return readAnswer(fields, job);
    case FromPeakWorkerKind.Failed:
      return { kind: FromPeakWorkerKind.Failed, job, reason: textAt(fields, 'reason') };
    default:
      throw new Malformed('kind', `one of ${Object.values(FromPeakWorkerKind).join(', ')}`);
  }
}

/** A message to the worker, read from its structured clone. */
export function readToPeakWorker(value: unknown): DomainResult<ToPeakWorker> {
  return readMessage(value, 'waveform.message-to-worker-malformed', readToWorker);
}

/** A message from the worker, read from its structured clone. */
export function readFromPeakWorker(value: unknown): DomainResult<FromPeakWorker> {
  return readMessage(value, 'waveform.message-from-worker-malformed', readFromWorker);
}
