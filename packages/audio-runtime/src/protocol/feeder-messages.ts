/**
 * The messages between the main thread and the feeder worker, which reads each
 * graph input's source and keeps the processor's feeds topped up.
 *
 * One discriminated union each way, each message read field by field on
 * arrival (`message-reading.ts`). The sources cross as descriptions, as a
 * render's do (`render-messages.ts`), since a source object cannot cross a
 * thread: the worker makes a tone itself with its canonical DSP, and recorded
 * audio arrives as its planar arrays, transferred rather than copied. They
 * are made once for a playback request and kept until it is released, so a
 * graph loaded again on a new audio context after a loss plays the same
 * sources without the main thread holding a copy.
 *
 * A binding joins the sources to one loaded processor: the rings they write
 * where memory is shared, and the feeder's end of the channel the posted
 * blocks and every rewind travel on. The main thread then only says where to
 * feed from and when to stop; the feeder says when the feeds hold audio to
 * start with, and when a source could not be read.
 *
 * The feeder is given a port to the preview worker once, which an edited
 * sound reads the renders of the chains it cannot run as it plays from
 * (ADR-0061); and a parameter changed while a request plays is sent to its
 * sources, which say whether their chains took it running.
 */

import {
  isWellFormedId,
  unsafeBrandId,
  type DomainResult,
  type QualityMode,
} from '@audiogubbins/domain';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';
import { DspImplementation, type ParameterChange } from '@audiogubbins/audio-engine';

import type { DspDelivery } from '../dsp/dsp-delivery.js';
import {
  MalformedMessage,
  countAt,
  dspDeliveryAt,
  failureSummaryFrom,
  flagAt,
  graphAt,
  listAt,
  moduleAt,
  nodeAt,
  nonEmptyListAt,
  numberAt,
  oneOf,
  qualityAt,
  optionalTextAt,
  portAt,
  readMessage,
  sharedMemoryAt,
  textAt,
  type FailureSummary,
  type Fields,
} from './message-reading.js';
import { FeedTransport } from './processor-messages.js';
import { sourceFrom, type SourceDescription } from './source-descriptions.js';

/** How one graph input's audio leaves the feeder. */
export type FeederBinding =
  | {
      readonly node: NodeId;
      readonly transport: typeof FeedTransport.SharedRing;
      /** The ring's memory, laid out by `feed/sample-ring.ts`, which the processor reads. */
      readonly ring: SharedArrayBuffer;
    }
  | { readonly node: NodeId; readonly transport: typeof FeedTransport.Posted };

/** The kinds of message the feeder is sent. */
export const ToFeederKind = {
  Sources: 'sources',
  Bind: 'bind',
  Start: 'start',
  Stop: 'stop',
  Unbind: 'unbind',
  Release: 'release',
  Previews: 'previews',
  Parameters: 'parameters',
} as const;

/** A message the feeder is sent. */
export type ToFeeder =
  | {
      /** Makes the sources of playback request `request`, which it keeps until released. */
      readonly kind: typeof ToFeederKind.Sources;
      readonly request: number;
      /** The graph the sources feed, whose graph inputs give each source its layout. */
      readonly graph: GraphDescriptor;
      readonly sources: readonly SourceDescription[];
      /** The quality a preview runs an edited sound's chains at (ADR-0061). */
      readonly quality: QualityMode;
      /** The canonical DSP compiled on the main thread, or why it could not be. */
      readonly dsp: DspDelivery<WebAssembly.Module>;
    }
  | {
      /** Joins request `request`'s sources to a loaded processor, replacing any binding. */
      readonly kind: typeof ToFeederKind.Bind;
      readonly request: number;
      readonly feeds: readonly FeederBinding[];
      /** The performance profile's time of audio each feed keeps queued, at most. */
      readonly feedAheadMilliseconds: number;
      /** The frames of one read. */
      readonly chunkFrames: number;
      /** How long a feed whose queue is full waits before it looks again. */
      readonly wakeMilliseconds: number;
      /** The feeder's end of the channel to the processor, transferred. */
      readonly processor: MessagePort;
    }
  | {
      /** Rewinds every feed to run `run`'s audio and feeds from timeline frame `from`. */
      readonly kind: typeof ToFeederKind.Start;
      readonly run: number;
      readonly from: number;
    }
  | {
      /** Stops feeding, leaving what the feeds hold where it is. */
      readonly kind: typeof ToFeederKind.Stop;
    }
  | {
      /** Stops feeding and lets go of the binding: its processor has gone. */
      readonly kind: typeof ToFeederKind.Unbind;
    }
  | {
      /** Releases request `request`'s sources, which nothing will play again. */
      readonly kind: typeof ToFeederKind.Release;
      readonly request: number;
    }
  | {
      /** The feeder's end of its channel to the preview worker, transferred, given once. */
      readonly kind: typeof ToFeederKind.Previews;
      readonly port: MessagePort;
    }
  | {
      /**
       * Numeric parameters changed while request `request` plays, for its
       * sources' chains to take running, answered as `change`.
       */
      readonly kind: typeof ToFeederKind.Parameters;
      readonly request: number;
      readonly change: number;
      readonly changes: readonly ParameterChange[];
    };

/** The kinds of message the feeder sends. */
export const FromFeederKind = {
  SourcesMade: 'sources-made',
  SourcesRefused: 'sources-refused',
  Primed: 'primed',
  FeedFailed: 'feed-failed',
  Fault: 'fault',
  ParametersTaken: 'parameters-taken',
} as const;

/** A message the feeder sends. */
export type FromFeeder =
  | {
      /** Request `request`'s sources are made, on the DSP given. */
      readonly kind: typeof FromFeederKind.SourcesMade;
      readonly request: number;
      readonly dsp: DspImplementation;
      /** Why the reference path runs, when it does. */
      readonly dspFallbackReason: string | undefined;
      /** Whether a source calls the canonical DSP at all, as a tone does. */
      readonly dspInUse: boolean;
    }
  | {
      /** Request `request`'s sources cannot be made, for every reason given. */
      readonly kind: typeof FromFeederKind.SourcesRefused;
      readonly request: number;
      readonly failures: readonly [FailureSummary, ...FailureSummary[]];
    }
  | {
      /** Every feed of run `run` has its first audio queued, or has ended. */
      readonly kind: typeof FromFeederKind.Primed;
      readonly run: number;
    }
  | {
      /** The source of `node` could not be read while feeding run `run`. */
      readonly kind: typeof FromFeederKind.FeedFailed;
      readonly run: number;
      readonly node: NodeId;
      readonly reason: string;
    }
  | {
      /** A message the feeder could not act on, so what it feeds is in doubt. */
      readonly kind: typeof FromFeederKind.Fault;
      readonly message: string;
    }
  | {
      /**
       * Whether the parameters of change `change` were taken running, or
       * every reason they were not, in which case the request must be
       * loaded again to be heard with them.
       */
      readonly kind: typeof FromFeederKind.ParametersTaken;
      readonly change: number;
      readonly refusals: readonly FailureSummary[];
    };

/** An identifier of the domain's form, or the field it was read from refused. */
function identifierAt(fields: Fields, field: string): string {
  const value = textAt(fields, field);
  if (!isWellFormedId(value)) throw new MalformedMessage(field, 'an identifier');
  return value;
}

function parameterChangeFrom(fields: Fields): ParameterChange {
  const value = numberAt(fields, 'value');
  return {
    processor: unsafeBrandId<'ProcessorId'>(identifierAt(fields, 'processor')),
    parameter: unsafeBrandId<'ParameterId'>(identifierAt(fields, 'parameter')),
    value,
  };
}

function bindingFrom(fields: Fields): FeederBinding {
  const node = nodeAt(fields, 'node');
  const transport = oneOf(fields, 'transport', FeedTransport);
  if (transport === FeedTransport.Posted) return { node, transport };
  return { node, transport, ring: sharedMemoryAt(fields, 'ring') };
}

function toFeederFrom(fields: Fields): ToFeeder {
  const kind = oneOf(fields, 'kind', ToFeederKind);
  switch (kind) {
    case ToFeederKind.Sources:
      return {
        kind,
        request: countAt(fields, 'request'),
        graph: graphAt(fields, 'graph'),
        sources: listAt(fields, 'sources', sourceFrom),
        quality: qualityAt(fields, 'quality'),
        dsp: dspDeliveryAt(fields, 'dsp', moduleAt),
      };
    case ToFeederKind.Bind:
      return {
        kind,
        request: countAt(fields, 'request'),
        feeds: listAt(fields, 'feeds', bindingFrom),
        feedAheadMilliseconds: numberAt(fields, 'feedAheadMilliseconds'),
        chunkFrames: countAt(fields, 'chunkFrames'),
        wakeMilliseconds: numberAt(fields, 'wakeMilliseconds'),
        processor: portAt(fields, 'processor'),
      };
    case ToFeederKind.Start:
      return { kind, run: countAt(fields, 'run'), from: countAt(fields, 'from') };
    case ToFeederKind.Stop:
    case ToFeederKind.Unbind:
      return { kind };
    case ToFeederKind.Release:
      return { kind, request: countAt(fields, 'request') };
    case ToFeederKind.Previews:
      return { kind, port: portAt(fields, 'port') };
    case ToFeederKind.Parameters:
      return {
        kind,
        request: countAt(fields, 'request'),
        change: countAt(fields, 'change'),
        changes: listAt(fields, 'changes', parameterChangeFrom),
      };
  }
}

function fromFeederFrom(fields: Fields): FromFeeder {
  const kind = oneOf(fields, 'kind', FromFeederKind);
  switch (kind) {
    case FromFeederKind.SourcesMade:
      return {
        kind,
        request: countAt(fields, 'request'),
        dsp: oneOf(fields, 'dsp', DspImplementation),
        dspFallbackReason: optionalTextAt(fields, 'dspFallbackReason'),
        dspInUse: flagAt(fields, 'dspInUse'),
      };
    case FromFeederKind.SourcesRefused:
      return {
        kind,
        request: countAt(fields, 'request'),
        failures: nonEmptyListAt(fields, 'failures', failureSummaryFrom),
      };
    case FromFeederKind.Primed:
      return { kind, run: countAt(fields, 'run') };
    case FromFeederKind.FeedFailed:
      return {
        kind,
        run: countAt(fields, 'run'),
        node: nodeAt(fields, 'node'),
        reason: textAt(fields, 'reason'),
      };
    case FromFeederKind.Fault:
      return { kind, message: textAt(fields, 'message') };
    case FromFeederKind.ParametersTaken:
      return {
        kind,
        change: countAt(fields, 'change'),
        refusals: listAt(fields, 'refusals', failureSummaryFrom),
      };
  }
}

/** A message the feeder received, read, or why it cannot be. */
export function readToFeeder(value: unknown): DomainResult<ToFeeder> {
  return readMessage(value, 'protocol.feeder-message-malformed', toFeederFrom);
}

/** A message the feeder sent, read, or why it cannot be. */
export function readFromFeeder(value: unknown): DomainResult<FromFeeder> {
  return readMessage(value, 'protocol.feeder-reply-malformed', fromFeederFrom);
}
