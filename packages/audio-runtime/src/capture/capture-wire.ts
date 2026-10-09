/**
 * The capture channel's wire format (ADR-0070): what the capture processor
 * sends the storage worker on the `MessagePort` the page hands each of them,
 * one channel a take.
 *
 * The recorded samples go straight from the audio thread to the storage worker,
 * so the page never holds them (ADR-0071). Where the page is cross-origin
 * isolated they cross in a ring of shared memory, and the messages only say how
 * far the ring holds the take; elsewhere they cross as posted blocks, their
 * buffers transferred, as playback feeds do (ADR-0007). Either way every frame
 * is named by the context frame it was captured at, a run of frames the
 * processor could not keep is said as a gap of that many frames, and the take
 * closes with an end that says why.
 *
 * A message is read field by field on arrival, by the domain's one reader of
 * a message's fields, so the storage worker trusts nothing it is sent.
 */

import {
  countAt,
  oneOf,
  rateAt,
  readMessage,
  sampleArraysAt,
  textAt,
  type DomainResult,
  type MessageFields,
  type SampleRate,
} from '@audiogubbins/domain';

import { sharedMemoryAt } from '../protocol/message-reading.js';

/** How a take's samples cross. */
export const CaptureTransport = {
  /** Blocks posted as messages, where memory cannot be shared. */
  Posted: 'posted',
  /** A ring of samples in shared memory, which the messages say how far is written. */
  SharedRing: 'shared-ring',
} as const;

export type CaptureTransport = (typeof CaptureTransport)[keyof typeof CaptureTransport];

/** Why a take's channel ended. */
export const CaptureEndReason = {
  /** The person stopped recording, at the end's frame. */
  Stopped: 'stopped',
  /** The input was let go of while recording: closed, or its device changed. */
  Released: 'released',
  /** The capture processor could not go on; the end says why. */
  Failed: 'failed',
} as const;

export type CaptureEndReason = (typeof CaptureEndReason)[keyof typeof CaptureEndReason];

/** The kinds of message on a capture channel. */
export const CaptureWireKind = {
  Begin: 'begin',
  Block: 'block',
  Written: 'written',
  Gap: 'gap',
  End: 'end',
} as const;

/** How a take's channel ended: the frame after its last, and why. */
export type CaptureEnd =
  | {
      readonly frame: number;
      readonly reason: typeof CaptureEndReason.Stopped | typeof CaptureEndReason.Released;
    }
  | {
      readonly frame: number;
      readonly reason: typeof CaptureEndReason.Failed;
      readonly summary: string;
    };

/** What a take's channel opens with: its first frame, its rate and channels, and how they cross. */
interface BeginFields {
  readonly kind: typeof CaptureWireKind.Begin;
  /** The context frame of the take's first frame, which a retrospective buffer moves earlier. */
  readonly frame: number;
  readonly sampleRate: SampleRate;
  readonly channels: number;
}

/** A message on a capture channel. */
export type CaptureWire =
  | (BeginFields & { readonly transport: typeof CaptureTransport.Posted })
  | (BeginFields & {
      readonly transport: typeof CaptureTransport.SharedRing;
      /** The ring's memory, laid out by `feed/sample-ring.ts`. */
      readonly ring: SharedArrayBuffer;
    })
  | {
      /** The take's frames from context frame `frame` on, one array per channel, transferred. */
      readonly kind: typeof CaptureWireKind.Block;
      readonly frame: number;
      readonly channels: readonly Float32Array[];
    }
  | {
      /** The ring holds the take up to, and not including, context frame `frame`. */
      readonly kind: typeof CaptureWireKind.Written;
      readonly frame: number;
    }
  | {
      /** `frames` frames from context frame `frame` were captured and could not be kept. */
      readonly kind: typeof CaptureWireKind.Gap;
      readonly frame: number;
      readonly frames: number;
    }
  | ({ readonly kind: typeof CaptureWireKind.End } & CaptureEnd);

function endFrom(fields: MessageFields): CaptureWire {
  const frame = countAt(fields, 'frame');
  const reason = oneOf(fields, 'reason', CaptureEndReason);
  return reason === CaptureEndReason.Failed
    ? { kind: CaptureWireKind.End, frame, reason, summary: textAt(fields, 'summary') }
    : { kind: CaptureWireKind.End, frame, reason };
}

function captureWireFrom(fields: MessageFields): CaptureWire {
  const kind = oneOf(fields, 'kind', CaptureWireKind);
  switch (kind) {
    case CaptureWireKind.Begin: {
      const begin = {
        kind,
        frame: countAt(fields, 'frame'),
        sampleRate: rateAt(fields, 'sampleRate'),
        channels: countAt(fields, 'channels'),
      };
      const transport = oneOf(fields, 'transport', CaptureTransport);
      return transport === CaptureTransport.Posted
        ? { ...begin, transport }
        : { ...begin, transport, ring: sharedMemoryAt(fields, 'ring') };
    }
    case CaptureWireKind.Block:
      return {
        kind,
        frame: countAt(fields, 'frame'),
        channels: sampleArraysAt(fields, 'channels'),
      };
    case CaptureWireKind.Written:
      return { kind, frame: countAt(fields, 'frame') };
    case CaptureWireKind.Gap:
      return { kind, frame: countAt(fields, 'frame'), frames: countAt(fields, 'frames') };
    case CaptureWireKind.End:
      return endFrom(fields);
  }
}

/** A message that arrived on a capture channel, read, or why it cannot be. */
export function readCaptureWire(value: unknown): DomainResult<CaptureWire> {
  return readMessage(value, 'capture.message-malformed', captureWireFrom);
}
