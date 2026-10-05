/**
 * Reading a peak message that crossed a thread, field by field
 * (REQ-EXEC-136.12). A reader throws at the first wrong field, which the
 * protocol's `read` function turns into a failure naming it.
 */

import {
  FailureKind,
  fail,
  failure,
  qualityModeFrom,
  succeed,
  type DomainResult,
  type QualityMode,
} from '@audiogubbins/domain';
import { pcmDescription, type PcmDescription } from '@audiogubbins/audio-engine';

import {
  FromPeakWorkerKind,
  ToPeakWorkerKind,
  type FrameRange,
  type FromPeakWorker,
  type ToPeakWorker,
} from './peak-messages.js';
import type { PeakChannel, PeakRun } from './peak-pyramid.js';

/** A field of a received message that is not what the protocol says. */
class Malformed extends Error {
  readonly field: string;

  constructor(field: string, expected: string) {
    super(`The message's ${field} is not ${expected}.`);
    this.name = 'Malformed';
    this.field = field;
  }
}

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldsOf(value: unknown, field: string): Fields {
  if (!isFields(value)) throw new Malformed(field, 'an object with named fields');
  return value;
}

function textAt(fields: Fields, field: string): string {
  const value = fields[field];
  if (typeof value !== 'string') throw new Malformed(field, 'text');
  return value;
}

function countAt(fields: Fields, field: string): number {
  const value = fields[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Malformed(field, 'a whole number, zero or more');
  }
  return value;
}

function rangeAt(fields: Fields, field: string): FrameRange {
  const range = fieldsOf(fields[field], field);
  const start = countAt(range, 'start');
  const end = countAt(range, 'end');
  if (end < start) throw new Malformed(field, 'a range that ends at or after its start');
  return { start, end };
}

function optionalRangeAt(fields: Fields, field: string): FrameRange | undefined {
  return fields[field] === undefined ? undefined : rangeAt(fields, field);
}

function tagged(value: unknown, tag: string): boolean {
  return Object.prototype.toString.call(value) === `[object ${tag}]`;
}

function isBytes(value: unknown): value is Uint8Array<ArrayBuffer> {
  return isUint8(value) && tagged(value.buffer, 'ArrayBuffer');
}

function bytesAt(fields: Fields, field: string): Uint8Array<ArrayBuffer> {
  const value = fields[field];
  if (!isBytes(value)) throw new Malformed(field, 'bytes');
  return value;
}

function optionalBytesAt(fields: Fields, field: string): Uint8Array<ArrayBuffer> | undefined {
  return fields[field] === undefined ? undefined : bytesAt(fields, field);
}

function countsAt(fields: Fields, field: string): readonly number[] {
  const value = fields[field];
  if (
    !Array.isArray(value) ||
    !value.every((one) => Number.isSafeInteger(one) && Number(one) >= 0)
  ) {
    throw new Malformed(field, 'a list of whole numbers');
  }
  return value.map(Number);
}

/**
 * Whether a value is of a typed array class, by its tag: a structured clone is
 * made in the receiving realm, whose class `instanceof` would not know.
 */
const isInt16 = (value: unknown): value is Int16Array => tagged(value, 'Int16Array');
const isUint8 = (value: unknown): value is Uint8Array => tagged(value, 'Uint8Array');
const isFloat32 = (value: unknown): value is Float32Array => tagged(value, 'Float32Array');

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
  const channels = fields['channels'];
  if (!Array.isArray(channels)) throw new Malformed(`${field}.channels`, 'a list');
  return {
    level: countAt(fields, 'level'),
    first: countAt(fields, 'first'),
    channels: channels.map((channel: unknown, index) =>
      channelOf(channel, `${field}.channels[${String(index)}]`),
    ),
  };
}

function runsAt(fields: Fields, field: string): readonly PeakRun[] {
  const value = fields[field];
  if (!Array.isArray(value)) throw new Malformed(field, 'a list');
  return value.map((run: unknown, index) => runOf(run, `${field}[${String(index)}]`));
}

function peakChannelsAt(fields: Fields, field: string): readonly PeakChannel[] {
  const value = fields[field];
  if (!Array.isArray(value)) throw new Malformed(field, 'a list');
  return value.map((channel: unknown, index) => channelOf(channel, `${field}[${String(index)}]`));
}

function samplesAt(fields: Fields, field: string): readonly Float32Array[] {
  const value = fields[field];
  if (!Array.isArray(value)) throw new Malformed(field, 'a list');
  return value.map((one: unknown, index) => arrayOf(one, `${field}[${String(index)}]`, isFloat32));
}

function descriptionAt(fields: Fields, field: string): PcmDescription {
  const read = pcmDescription(fields[field]);
  if (!read.ok) throw new Malformed(field, `a description of audio (${read.failures[0].summary})`);
  return read.value;
}

/** A quality mode, its level taken from its settings as the domain reads them. */
function qualityAt(fields: Fields, field: string): QualityMode {
  const value = fields[field];
  const settings =
    typeof value === 'object' && value !== null && 'settings' in value ? value.settings : undefined;
  const mode = qualityModeFrom(settings);
  if (!mode.ok) throw new Malformed(field, 'a quality mode');
  return mode.value;
}

function readToWorker(fields: Fields): ToPeakWorker {
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
        quality: qualityAt(fields, 'quality'),
        cached: optionalBytesAt(fields, 'cached'),
        focus: optionalRangeAt(fields, 'focus'),
      };
    case ToPeakWorkerKind.Focus:
      return { kind: ToPeakWorkerKind.Focus, job, range: rangeAt(fields, 'range') };
    case ToPeakWorkerKind.Samples:
      return {
        kind: ToPeakWorkerKind.Samples,
        job,
        request: countAt(fields, 'request'),
        range: rangeAt(fields, 'range'),
      };
    case ToPeakWorkerKind.Buckets:
      return {
        kind: ToPeakWorkerKind.Buckets,
        job,
        request: countAt(fields, 'request'),
        range: rangeAt(fields, 'range'),
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
function readAnswer(fields: Fields, job: string): FromPeakWorker {
  switch (fields['kind']) {
    case FromPeakWorkerKind.Samples:
      return {
        kind: FromPeakWorkerKind.Samples,
        job,
        request: countAt(fields, 'request'),
        start: countAt(fields, 'start'),
        channels: samplesAt(fields, 'channels'),
      };
    case FromPeakWorkerKind.Buckets:
      return {
        kind: FromPeakWorkerKind.Buckets,
        job,
        request: countAt(fields, 'request'),
        start: countAt(fields, 'start'),
        frames: countAt(fields, 'frames'),
        bucketFrames: countAt(fields, 'bucketFrames'),
        channels: peakChannelsAt(fields, 'channels'),
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

function readFromWorker(fields: Fields): FromPeakWorker {
  const job = textAt(fields, 'job');
  switch (fields['kind']) {
    case FromPeakWorkerKind.Adopted:
      return { kind: FromPeakWorkerKind.Adopted, job, bytes: bytesAt(fields, 'bytes') };
    case FromPeakWorkerKind.Runs:
      return { kind: FromPeakWorkerKind.Runs, job, runs: runsAt(fields, 'runs') };
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

function read<T>(value: unknown, code: string, reader: (fields: Fields) => T): DomainResult<T> {
  try {
    return succeed(reader(fieldsOf(value, 'body')));
  } catch (error) {
    if (!(error instanceof Malformed)) throw error;
    return fail(
      failure(code, FailureKind.Rejected, error.message, { details: { field: error.field } }),
    );
  }
}

/** A message to the worker, read from its structured clone. */
export function readToPeakWorker(value: unknown): DomainResult<ToPeakWorker> {
  return read(value, 'waveform.message-to-worker-malformed', readToWorker);
}

/** A message from the worker, read from its structured clone. */
export function readFromPeakWorker(value: unknown): DomainResult<FromPeakWorker> {
  return read(value, 'waveform.message-from-worker-malformed', readFromWorker);
}
