/**
 * The messages between the main thread and a render worker.
 *
 * One discriminated union each way, each message read field by field on
 * arrival (`message-reading.ts`), as the processor's protocol is. A render is
 * one `render` message holding the whole job: the graph as its descriptor, the
 * span and rate, and each graph input's audio described rather than bound,
 * since a source object cannot cross a thread. Recorded audio crosses as its
 * planar arrays, transferred rather than copied, so a long clip is never held
 * twice (the packet's "large media processing must avoid whole-file
 * duplication"); its layout is the graph input's port's, which the worker
 * reads from the graph, so no layout crosses the wire to disagree with it.
 *
 * The rendered audio comes back a chunk at a time, and the worker sends no
 * more than it may hold unacknowledged (`render/chunk-window.ts`): each chunk
 * is answered with `chunk-taken` once the main thread has written it, so a
 * slow sink bounds the audio in flight rather than a queue growing without
 * limit.
 */

import {
  FailureKind,
  failure,
  sampleCount,
  sampleRate,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  nodeId,
  readGraphDescriptor,
  type GraphDescriptor,
  type NodeId,
} from '@audiogubbins/audio-graph';
import {
  DspImplementation,
  ResamplingQuality,
  type RenderConversion,
  type RenderRange,
} from '@audiogubbins/audio-engine';

import {
  MalformedMessage,
  channelsAt,
  countAt,
  fieldsOf,
  numberAt,
  oneOf,
  optionalModuleAt,
  optionalTextAt,
  readMessage,
  textAt,
  type Fields,
} from './message-reading.js';

/** How a graph input's audio is described to the worker. */
export const SourceKind = {
  /** Audio in memory: a decoded clip's planar samples. */
  Pcm: 'pcm',
  /** A test tone the worker makes itself from the canonical oscillator. */
  Tone: 'tone',
} as const;

export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

/** The audio one graph input reads, as it crosses to the worker. */
export type SourceDescription =
  | {
      readonly node: NodeId;
      readonly kind: typeof SourceKind.Pcm;
      readonly sampleRate: SampleRate;
      /**
       * One array per channel of the input's port, in its order, all the same
       * length. Transferred: the sender's arrays are detached once posted.
       */
      readonly channels: readonly Float32Array[];
    }
  | {
      readonly node: NodeId;
      readonly kind: typeof SourceKind.Tone;
      readonly sampleRate: SampleRate;
      readonly frequency: number;
      readonly amplitude: number;
      readonly frames: SampleCount;
    };

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
      readonly resamplingQuality: ResamplingQuality;
      readonly sources: readonly SourceDescription[];
      /** The canonical DSP compiled on the main thread, or none where it could not be. */
      readonly dspModule: WebAssembly.Module | undefined;
      /** Why there is no module, when there is none, for the worker to report. */
      readonly dspUnavailable: string | undefined;
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

function nodeAt(fields: Fields, field: string): NodeId {
  const read = nodeId(textAt(fields, field));
  if (!read.ok) throw new MalformedMessage(field, 'a node identifier');
  return read.value;
}

function rateAt(fields: Fields, field: string): SampleRate {
  const read = sampleRate(numberAt(fields, field));
  if (!read.ok) throw new MalformedMessage(field, 'a sample rate');
  return read.value;
}

function samplesAt(fields: Fields, field: string): SampleCount {
  const read = sampleCount(countAt(fields, field));
  if (!read.ok) throw new MalformedMessage(field, 'a count of samples');
  return read.value;
}

function graphAt(fields: Fields): GraphDescriptor {
  const graph = readGraphDescriptor(fields['graph']);
  if (!graph.ok) throw new MalformedMessage('graph', 'a graph descriptor');
  return graph.value;
}

/** One of the resampler's qualities, which are numbers and so not `oneOf`'s text. */
function qualityAt(fields: Fields, field: string): ResamplingQuality {
  const value = fields[field];
  const found = Object.values(ResamplingQuality).find((one) => one === value);
  if (found === undefined) {
    throw new MalformedMessage(field, `one of ${Object.values(ResamplingQuality).join(', ')}`);
  }
  return found;
}

/** A failure's details: named text, numbers and flags. */
function detailsAt(fields: Fields): DomainFailure['details'] {
  if (fields['details'] === undefined) return undefined;
  const details = fieldsOf(fields['details'], 'details');
  const isDetail = (one: unknown): one is string | number | boolean =>
    typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean';
  const read: Record<string, string | number | boolean> = {};
  for (const [name, one] of Object.entries(details)) {
    if (!isDetail(one)) throw new MalformedMessage(`details.${name}`, 'text, a number or a flag');
    read[name] = one;
  }
  return read;
}

/** A failure as the domain states it, with the failure it arose from, if any. */
function failureFrom(fields: Fields): DomainFailure {
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

function failuresAt(fields: Fields): RenderFailures {
  const [first, ...rest] = listAt(fields, 'failures', failureFrom);
  if (first === undefined) throw new MalformedMessage('failures', 'a list of at least one failure');
  return [first, ...rest];
}

/** The elements of a list, each read as an object named by its place. */
function listAt<TItem>(
  fields: Fields,
  field: string,
  read: (item: Fields) => TItem,
): readonly TItem[] {
  const value: unknown = fields[field];
  if (!Array.isArray(value)) throw new MalformedMessage(field, 'a list');
  return value.map((item: unknown, index) => read(fieldsOf(item, `${field}[${String(index)}]`)));
}

function rangeAt(fields: Fields): RenderRange {
  const range = fieldsOf(fields['range'], 'range');
  return { start: samplesAt(range, 'start'), length: samplesAt(range, 'length') };
}

function sourceFrom(fields: Fields): SourceDescription {
  const node = nodeAt(fields, 'node');
  const rate = rateAt(fields, 'sampleRate');
  const kind = oneOf(fields, 'kind', SourceKind);
  switch (kind) {
    case SourceKind.Pcm:
      return { node, kind, sampleRate: rate, channels: channelsAt(fields, 'channels') };
    case SourceKind.Tone:
      return {
        node,
        kind,
        sampleRate: rate,
        frequency: numberAt(fields, 'frequency'),
        amplitude: numberAt(fields, 'amplitude'),
        frames: samplesAt(fields, 'frames'),
      };
  }
}

function trimFrom(value: unknown, index: number): readonly [NodeId, SampleCount] {
  const name = `latencyTrimmed[${String(index)}]`;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new MalformedMessage(name, 'a node and a count of frames');
  }
  const pair: Fields = { node: value[0], frames: value[1] };
  return [nodeAt(pair, 'node'), samplesAt(pair, 'frames')];
}

function trimsAt(fields: Fields): readonly (readonly [NodeId, SampleCount])[] {
  const value: unknown = fields['latencyTrimmed'];
  if (!Array.isArray(value)) throw new MalformedMessage('latencyTrimmed', 'a list');
  return value.map(trimFrom);
}

function conversionFrom(fields: Fields): RenderConversion {
  return {
    node: nodeAt(fields, 'node'),
    from: rateAt(fields, 'from'),
    to: rateAt(fields, 'to'),
    quality: qualityAt(fields, 'quality'),
  };
}

function toRenderWorkerFrom(fields: Fields): ToRenderWorker {
  const kind = oneOf(fields, 'kind', ToRenderWorkerKind);
  const jobId = textAt(fields, 'jobId');
  switch (kind) {
    case ToRenderWorkerKind.Render:
      return {
        kind,
        jobId,
        graph: graphAt(fields),
        sampleRate: rateAt(fields, 'sampleRate'),
        range: rangeAt(fields),
        chunkFrames: countAt(fields, 'chunkFrames'),
        resamplingQuality: qualityAt(fields, 'resamplingQuality'),
        sources: listAt(fields, 'sources', sourceFrom),
        dspModule: optionalModuleAt(fields, 'dspModule'),
        dspUnavailable: optionalTextAt(fields, 'dspUnavailable'),
      };
    case ToRenderWorkerKind.ChunkTaken:
    case ToRenderWorkerKind.Cancel:
      return { kind, jobId };
  }
}

function fromRenderWorkerFrom(fields: Fields): FromRenderWorker {
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
        channels: channelsAt(fields, 'channels'),
      };
    case FromRenderWorkerKind.Done:
      return {
        kind,
        jobId,
        frames: samplesAt(fields, 'frames'),
        latencyTrimmed: trimsAt(fields),
        conversions: listAt(fields, 'conversions', conversionFrom),
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
