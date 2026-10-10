/**
 * The messages between the main thread and a render worker.
 *
 * One discriminated union each way, each message read field by field on
 * arrival (`message-reading.ts`), as the processor's protocol is. A render is
 * one `render` message holding the whole job: the graph as its descriptor, the
 * span and rate, and each graph input's audio described rather than bound
 * (`source-descriptions.ts`), since a source object cannot cross a thread.
 *
 * The rendered audio comes back a chunk at a time, and the worker sends no
 * more than it may hold unacknowledged (`render/chunk-window.ts`): each chunk
 * is answered with `chunk-taken` once the main thread has written it, so a
 * slow sink bounds the audio in flight rather than a queue growing without
 * limit.
 */

import {
  FailureKind,
  Malformed,
  countAt,
  failure,
  fieldsOf,
  itemsAt,
  nonEmptyObjectsAt,
  objectsAt,
  oneOf,
  optionalCountAt,
  optionalTextAt,
  qualityModeAt,
  rateAt,
  readMessage,
  sampleArraysAt,
  sampleCountAt,
  textAt,
  type DomainFailure,
  type DomainResult,
  type MessageFields,
  type QualityMode,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';
import {
  DspImplementation,
  ResamplingQuality,
  type RenderConversion,
  type RenderRange,
  type DspDelivery,
  dspDeliveryAt,
} from '@audiogubbins/audio-engine';

import { graphAt, moduleAt, nodeAt } from './message-reading.js';
import { sourceFrom, type SourceDescription } from './source-descriptions.js';

/** The kinds of message a render worker is sent. */
export const ToRenderWorkerKind = {
  Render: 'render',
  ChunkTaken: 'chunk-taken',
  Cancel: 'cancel',
} as const;

/** A message a render worker is sent. */
export type ToRenderWorker =
  | {
      /** Renders a job; a worker renders one at a time. */
      readonly kind: typeof ToRenderWorkerKind.Render;
      readonly jobId: string;
      readonly graph: GraphDescriptor;
      readonly sampleRate: SampleRate;
      readonly range: RenderRange;
      readonly chunkFrames: number;
      /** The quality the render runs at (ADR-0061). */
      readonly quality: QualityMode;
      readonly sources: readonly SourceDescription[];
      /** What the conversions' tables may hold together, or `undefined` where unmeasured. */
      readonly coefficientBudgetBytes: number | undefined;
      /** The canonical DSP compiled on the main thread, or why it could not be. */
      readonly dsp: DspDelivery<WebAssembly.Module>;
    }
  | {
      /** The main thread has written one chunk, so the worker may send another. */
      readonly kind: typeof ToRenderWorkerKind.ChunkTaken;
      readonly jobId: string;
    }
  | {
      readonly kind: typeof ToRenderWorkerKind.Cancel;
      readonly jobId: string;
    };

/** The kinds of message a render worker sends. */
export const FromRenderWorkerKind = {
  Progress: 'progress',
  Chunk: 'chunk',
  Done: 'done',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Refused: 'refused',
} as const;

/** Every reason a job failed, at least one, as a structured clone carries them. */
export type RenderFailures = readonly [DomainFailure, ...DomainFailure[]];

/** A message a render worker sends. */
export type FromRenderWorker =
  | {
      readonly kind: typeof FromRenderWorkerKind.Progress;
      readonly jobId: string;
      readonly framesRendered: number;
      readonly framesTotal: number;
    }
  | {
      /** The next frames of one sink, in order. Transferred. */
      readonly kind: typeof FromRenderWorkerKind.Chunk;
      readonly jobId: string;
      readonly node: NodeId;
      readonly channels: readonly Float32Array[];
    }
  | {
      /** Every chunk has been sent. */
      readonly kind: typeof FromRenderWorkerKind.Done;
      readonly jobId: string;
      readonly frames: SampleCount;
      readonly latencyTrimmed: readonly (readonly [NodeId, SampleCount])[];
      readonly conversions: readonly RenderConversion[];
      /** The DSP the render ran on, for the Audio engine panel (ADR-0031). */
      readonly dsp: DspImplementation;
      /** Why the reference path ran, when it did. */
      readonly dspFallbackReason: string | undefined;
    }
  | {
      /**
       * The job could not be rendered, with every failure as the worker's
       * engine stated it, so the main thread reports the same codes.
       */
      readonly kind: typeof FromRenderWorkerKind.Failed;
      readonly jobId: string;
      readonly failures: RenderFailures;
    }
  | {
      readonly kind: typeof FromRenderWorkerKind.Cancelled;
      readonly jobId: string;
    }
  | {
      /**
       * A message the worker could not read, so it cannot say which job it
       * belonged to; a worker serves one job, so the host fails that one.
       */
      readonly kind: typeof FromRenderWorkerKind.Refused;
      readonly failures: RenderFailures;
    };

/** A failure's details: named text, numbers and flags. */
function detailsAt(fields: MessageFields): DomainFailure['details'] {
  if (fields['details'] === undefined) return undefined;
  const details = fieldsOf(fields['details'], 'details');
  const isDetail = (one: unknown): one is string | number | boolean =>
    typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean';
  const read: Record<string, string | number | boolean> = {};
  for (const [name, one] of Object.entries(details)) {
    if (!isDetail(one)) throw new Malformed(`details.${name}`, 'text, a number or a flag');
    read[name] = one;
  }
  return read;
}

/** A failure as the domain states it, with the failure it arose from, if any. */
function failureFrom(fields: MessageFields): DomainFailure {
  const details = detailsAt(fields);
  const cause =
    fields['cause'] === undefined ? undefined : failureFrom(fieldsOf(fields['cause'], 'cause'));
  return failure(
    textAt(fields, 'code'),
    oneOf(fields, 'kind', FailureKind),
    textAt(fields, 'summary'),
    {
      ...(details === undefined ? {} : { details }),
      ...(cause === undefined ? {} : { cause }),
    },
  );
}

function failuresAt(fields: MessageFields): RenderFailures {
  return nonEmptyObjectsAt(fields, 'failures', failureFrom);
}

function rangeAt(fields: MessageFields): RenderRange {
  const range = fieldsOf(fields['range'], 'range');
  return { start: sampleCountAt(range, 'start'), length: sampleCountAt(range, 'length') };
}

function trimFrom(value: unknown, name: string): readonly [NodeId, SampleCount] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Malformed(name, 'a node and a count of frames');
  }
  const pair: MessageFields = { node: value[0], frames: value[1] };
  return [nodeAt(pair, 'node'), sampleCountAt(pair, 'frames')];
}

function conversionFrom(fields: MessageFields): RenderConversion {
  return {
    node: nodeAt(fields, 'node'),
    from: rateAt(fields, 'from'),
    to: rateAt(fields, 'to'),
    quality: oneOf(fields, 'quality', ResamplingQuality),
  };
}

function toRenderWorkerFrom(fields: MessageFields): ToRenderWorker {
  const kind = oneOf(fields, 'kind', ToRenderWorkerKind);
  const jobId = textAt(fields, 'jobId');
  switch (kind) {
    case ToRenderWorkerKind.Render:
      return {
        kind,
        jobId,
        graph: graphAt(fields, 'graph'),
        sampleRate: rateAt(fields, 'sampleRate'),
        range: rangeAt(fields),
        chunkFrames: countAt(fields, 'chunkFrames'),
        quality: qualityModeAt(fields, 'quality'),
        sources: objectsAt(fields, 'sources', sourceFrom),
        coefficientBudgetBytes: optionalCountAt(fields, 'coefficientBudgetBytes'),
        dsp: dspDeliveryAt(fields, 'dsp', moduleAt),
      };
    case ToRenderWorkerKind.ChunkTaken:
    case ToRenderWorkerKind.Cancel:
      return { kind, jobId };
  }
}

function fromRenderWorkerFrom(fields: MessageFields): FromRenderWorker {
  const kind = oneOf(fields, 'kind', FromRenderWorkerKind);
  if (kind === FromRenderWorkerKind.Refused) return { kind, failures: failuresAt(fields) };
  const jobId = textAt(fields, 'jobId');
  switch (kind) {
    case FromRenderWorkerKind.Progress:
      return {
        kind,
        jobId,
        framesRendered: countAt(fields, 'framesRendered'),
        framesTotal: countAt(fields, 'framesTotal'),
      };
    case FromRenderWorkerKind.Chunk:
      return {
        kind,
        jobId,
        node: nodeAt(fields, 'node'),
        channels: sampleArraysAt(fields, 'channels'),
      };
    case FromRenderWorkerKind.Done:
      return {
        kind,
        jobId,
        frames: sampleCountAt(fields, 'frames'),
        latencyTrimmed: itemsAt(fields, 'latencyTrimmed', trimFrom),
        conversions: objectsAt(fields, 'conversions', conversionFrom),
        dsp: oneOf(fields, 'dsp', DspImplementation),
        dspFallbackReason: optionalTextAt(fields, 'dspFallbackReason'),
      };
    case FromRenderWorkerKind.Failed:
      return { kind, jobId, failures: failuresAt(fields) };
    case FromRenderWorkerKind.Cancelled:
      return { kind, jobId };
  }
}

/** A message a render worker received, read, or why it cannot be. */
export function readToRenderWorker(value: unknown): DomainResult<ToRenderWorker> {
  return readMessage(value, 'protocol.render-message-malformed', toRenderWorkerFrom);
}

/** A message a render worker sent, read, or why it cannot be. */
export function readFromRenderWorker(value: unknown): DomainResult<FromRenderWorker> {
  return readMessage(value, 'protocol.render-reply-malformed', fromRenderWorkerFrom);
}
