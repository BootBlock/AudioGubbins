/**
 * The messages between the main thread and the engine's AudioWorklet
 * processor.
 *
 * One discriminated union each way, each message read field by field on
 * arrival (`message-reading.ts`), so a message name is a member of a type
 * rather than a string two files agree on. The graph crosses as its
 * descriptor, which the processor reads and compiles itself: the plan is
 * derived data, and the descriptor already has a reader that trusts nothing.
 *
 * The transport's state machine stays on the main thread, where the person's
 * commands arrive. The processor is told only to run or halt; it counts where
 * playback is, the timeline frames that have left the graph for the output,
 * and says so when it starts, in each periodic report and when it halts or
 * reaches the end, which is what the main thread anchors the media clock to.
 *
 * The audio itself does not come this way. The feeder worker sends it, or the
 * rewinds of shared rings, through a channel of its own (`feed-messages.ts`),
 * whose far end crosses here in the `load`.
 */

import {
  bytesAt,
  countAt,
  failureSummaryOf,
  flagAt,
  nonEmptyObjectsAt,
  numberAt,
  numbersAt,
  objectsAt,
  oneOf,
  optionalCountAt,
  optionalTextAt,
  readMessage,
  textAt,
  textsAt,
  type DomainResult,
  type FailureSummary,
  type MessageFields,
} from '@audiogubbins/domain';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';
import { DspImplementation, type DspDelivery, dspDeliveryAt } from '@audiogubbins/audio-engine';

import { graphAt, nodeAt, optionalPortAt, sharedMemoryAt } from './message-reading.js';

/** How a graph input's audio reaches the processor. */
export const FeedTransport = {
  /** A ring of samples in memory both threads share, read without a message. */
  SharedRing: 'shared-ring',
  /** Blocks posted as messages, where memory cannot be shared. */
  Posted: 'posted',
} as const;

export type FeedTransport = (typeof FeedTransport)[keyof typeof FeedTransport];

/** Where one graph input's audio comes from. */
export type FeedBinding =
  | {
      readonly node: NodeId;
      readonly transport: typeof FeedTransport.SharedRing;
      readonly channels: number;
      /** The ring's memory, laid out by `feed/sample-ring.ts`. */
      readonly ring: SharedArrayBuffer;
    }
  | {
      readonly node: NodeId;
      readonly transport: typeof FeedTransport.Posted;
      readonly channels: number;
    };

/** The kinds of message the processor is sent. */
export const ToProcessorKind = {
  Load: 'load',
  Start: 'start',
  Halt: 'halt',
  SetParameter: 'set-parameter',
} as const;

/** A message the processor is sent. */
export type ToProcessor =
  | {
      /** Replaces the running graph, and halts. */
      readonly kind: typeof ToProcessorKind.Load;
      readonly graph: GraphDescriptor;
      /**
       * The canonical DSP module's bytes, which the processor compiles, or why
       * the main thread has none to send. Bytes rather than a compiled module:
       * Chromium silently drops a message to an AudioWorklet that carries a
       * module, and delivers one that carries bytes. Copied, not transferred,
       * since the main thread keeps them for the next load.
       */
      readonly dsp: DspDelivery<Uint8Array<ArrayBuffer>>;
      readonly feeds: readonly FeedBinding[];
      /** Quanta between two reports: the rate the main thread hears the count and the meters at. */
      readonly reportEveryBlocks: number;
      /**
       * The processor's end of the channel to the feeder, transferred, where
       * the graph has feeds: the posted blocks and every feed's rewinds arrive
       * on it.
       */
      readonly feeder: MessagePort | undefined;
    }
  | {
      /**
       * Starts a run. `run` names it, a whole number the main thread raises
       * with each run, and every reply about the run carries it back, so a
       * reply about an earlier run that arrives after a later one began is
       * told apart rather than taken for the new run's.
       *
       * `epoch` names the audio the run plays: the run whose rewind of the
       * feeds it follows. Where it is the audio the processor already holds, a
       * pause is being resumed, and the graph goes on with its history and its
       * count. Otherwise the processor waits for the feeds' rewind to `epoch`,
       * which the feeder sends on its own channel, and then starts afresh, its
       * graph made again and its count at timeline frame `from`.
       */
      readonly kind: typeof ToProcessorKind.Start;
      readonly run: number;
      readonly epoch: number;
      readonly from: number;
    }
  | {
      /** Halts where it is, keeping the graph's history and the feeds' audio, and says where. */
      readonly kind: typeof ToProcessorKind.Halt;
    }
  | {
      readonly kind: typeof ToProcessorKind.SetParameter;
      readonly node: NodeId;
      readonly name: string;
      readonly value: number;
    };

/** The kinds of message the processor sends. */
export const FromProcessorKind = {
  Loaded: 'loaded',
  Refused: 'refused',
  Started: 'started',
  Report: 'report',
  Halted: 'halted',
  FeedsEnded: 'feeds-ended',
  ParameterRefused: 'parameter-refused',
  Fault: 'fault',
} as const;

/** One meter's readings over the quanta since the last report, one value per channel or pair. */
export interface MeterReport {
  readonly node: NodeId;
  readonly peak: readonly number[];
  readonly rms: readonly number[];
  /** The phase correlation of each pair the meter's `correlate` setting names, in its order. */
  readonly correlation: readonly number[];
}

/**
 * Where playback is, as the processor counts it: timeline frame `position`
 * reaches the output at context frame `contextFrame`. Ahead of the context
 * while a start's first frame is still passing through the graph's latency.
 */
export interface CountedPosition {
  readonly contextFrame: number;
  readonly position: number;
}

/** A message the processor sends. */
export type FromProcessor =
  | {
      /** The graph is compiled and its kernels made. */
      readonly kind: typeof FromProcessorKind.Loaded;
      readonly dsp: DspImplementation;
      /** Why the reference path runs, when it does. */
      readonly dspFallbackReason: string | undefined;
      /** Whether a node of the graph calls the canonical DSP at all. */
      readonly dspInUse: boolean;
      /** The graph's latency in frames at the context's rate, where it is known. */
      readonly latencyFrames: number | undefined;
    }
  | {
      /** The graph cannot run here, and every reason. */
      readonly kind: typeof FromProcessorKind.Refused;
      readonly reasons: readonly string[];
    }
  | ({
      /** Processing of run `run` began, at the count given. */
      readonly kind: typeof FromProcessorKind.Started;
      readonly run: number;
    } & CountedPosition)
  | ({
      /**
       * The count while run `run` plays, the underruns since the last report,
       * and every meter's readings, in one message a report.
       */
      readonly kind: typeof FromProcessorKind.Report;
      readonly run: number;
      /** The frames the device played as silence because a feed had not a whole quantum ready. */
      readonly underrunFrames: number;
      /** The quanta that ran short, each an underrun. */
      readonly underruns: number;
      readonly meters: readonly MeterReport[];
    } & CountedPosition)
  | ({
      /** Run `run` halted, at the count given, which is where it goes on from. */
      readonly kind: typeof FromProcessorKind.Halted;
      readonly run: number;
    } & CountedPosition)
  | ({
      /** Every feed of run `run` has ended and its last frame reached the output, at the count given. */
      readonly kind: typeof FromProcessorKind.FeedsEnded;
      readonly run: number;
    } & CountedPosition)
  | {
      /** A node refused a parameter, which keeps the value it had; playing goes on. */
      readonly kind: typeof FromProcessorKind.ParameterRefused;
      readonly node: NodeId;
      readonly name: string;
      /**
       * Every reason, the first of them the one to show: each failure's code
       * and summary, which are all of a failure that means anything off the
       * audio thread.
       */
      readonly failures: readonly [FailureSummary, ...FailureSummary[]];
    }
  | {
      /** Processing threw, and the processor now outputs silence. */
      readonly kind: typeof FromProcessorKind.Fault;
      readonly message: string;
    };

function feedFrom(fields: MessageFields): FeedBinding {
  const node = nodeAt(fields, 'node');
  const channels = countAt(fields, 'channels');
  const transport = oneOf(fields, 'transport', FeedTransport);
  if (transport === FeedTransport.Posted) return { node, transport, channels };
  return { node, transport, channels, ring: sharedMemoryAt(fields, 'ring') };
}

function meterFrom(fields: MessageFields): MeterReport {
  return {
    node: nodeAt(fields, 'node'),
    peak: numbersAt(fields, 'peak'),
    rms: numbersAt(fields, 'rms'),
    correlation: numbersAt(fields, 'correlation'),
  };
}

function countedAt(fields: MessageFields): CountedPosition {
  return { contextFrame: countAt(fields, 'contextFrame'), position: countAt(fields, 'position') };
}

function toProcessorFrom(fields: MessageFields): ToProcessor {
  const kind = oneOf(fields, 'kind', ToProcessorKind);
  switch (kind) {
    case ToProcessorKind.Load:
      return {
        kind,
        graph: graphAt(fields, 'graph'),
        dsp: dspDeliveryAt(fields, 'dsp', bytesAt),
        feeds: objectsAt(fields, 'feeds', feedFrom),
        reportEveryBlocks: countAt(fields, 'reportEveryBlocks'),
        feeder: optionalPortAt(fields, 'feeder'),
      };
    case ToProcessorKind.Start:
      return {
        kind,
        run: countAt(fields, 'run'),
        epoch: countAt(fields, 'epoch'),
        from: countAt(fields, 'from'),
      };
    case ToProcessorKind.Halt:
      return { kind };
    case ToProcessorKind.SetParameter:
      return {
        kind,
        node: nodeAt(fields, 'node'),
        name: textAt(fields, 'name'),
        value: numberAt(fields, 'value'),
      };
  }
}

function fromProcessorFrom(fields: MessageFields): FromProcessor {
  const kind = oneOf(fields, 'kind', FromProcessorKind);
  switch (kind) {
    case FromProcessorKind.Loaded:
      return {
        kind,
        dsp: oneOf(fields, 'dsp', DspImplementation),
        dspFallbackReason: optionalTextAt(fields, 'dspFallbackReason'),
        dspInUse: flagAt(fields, 'dspInUse'),
        latencyFrames: optionalCountAt(fields, 'latencyFrames'),
      };
    case FromProcessorKind.Refused:
      return { kind, reasons: textsAt(fields, 'reasons') };
    case FromProcessorKind.Started:
    case FromProcessorKind.Halted:
    case FromProcessorKind.FeedsEnded:
      return { kind, run: countAt(fields, 'run'), ...countedAt(fields) };
    case FromProcessorKind.Report:
      return {
        kind,
        run: countAt(fields, 'run'),
        ...countedAt(fields),
        underrunFrames: countAt(fields, 'underrunFrames'),
        underruns: countAt(fields, 'underruns'),
        meters: objectsAt(fields, 'meters', meterFrom),
      };
    case FromProcessorKind.ParameterRefused:
      return {
        kind,
        node: nodeAt(fields, 'node'),
        name: textAt(fields, 'name'),
        failures: nonEmptyObjectsAt(fields, 'failures', failureSummaryOf),
      };
    case FromProcessorKind.Fault:
      return { kind, message: textAt(fields, 'message') };
  }
}

/** A message the processor received, read, or why it cannot be. */
export function readToProcessor(value: unknown): DomainResult<ToProcessor> {
  return readMessage(value, 'protocol.processor-message-malformed', toProcessorFrom);
}

/** A message the processor sent, read, or why it cannot be. */
export function readFromProcessor(value: unknown): DomainResult<FromProcessor> {
  return readMessage(value, 'protocol.processor-reply-malformed', fromProcessorFrom);
}
