/**
 * The messages of a rendered-block channel: one render sink's audio sent from
 * the render worker straight to the worker that consumes it, as an export's
 * blocks go to the codec worker without passing through the page (ADR-0092).
 *
 * The render side sends blocks in order, their buffers transferred, then one
 * end with the frames rendered, or the failures that ended the render. The
 * consumer grants credit: each `credit` lets the render side send that many
 * more blocks, so it never runs ahead of the consumer by more than it was
 * granted and neither side holds a whole sound (G4). A consumer that cannot go
 * on refuses, and the render stops.
 *
 * Both ends read what they are sent field by field, as every thread boundary
 * does. The types live in the engine, beside `RenderSink`, so the render host
 * that sends them and the codec runtime that consumes them depend on one
 * definition and neither on the other.
 */

import {
  Malformed,
  countAt,
  domainFailuresAt,
  oneOf,
  readMessage,
  sampleArraysAt,
  sampleCountAt,
  type DomainFailure,
  type DomainResult,
  type MessageFields,
  type SampleCount,
} from '@audiogubbins/domain';

/** The kinds of message the render side sends. */
export const RenderedBlockKind = {
  Block: 'block',
  End: 'end',
  Failed: 'failed',
} as const;

/** What the render side sends. */
export type RenderedBlockMessage =
  | {
      /** The next frames, one plane per channel of the sink's layout, of one length. */
      readonly kind: typeof RenderedBlockKind.Block;
      readonly channels: readonly Float32Array[];
    }
  | {
      /** Every block has been sent; the render made `frames` frames. */
      readonly kind: typeof RenderedBlockKind.End;
      readonly frames: SampleCount;
    }
  | {
      /** The render failed or was cancelled, and sends no more. */
      readonly kind: typeof RenderedBlockKind.Failed;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };

/** The kinds of message the consumer sends. */
export const BlockReplyKind = {
  Credit: 'credit',
  Refused: 'refused',
} as const;

/** What the consumer sends. */
export type RenderedBlockReply =
  | {
      /** The render side may send `blocks` more blocks. */
      readonly kind: typeof BlockReplyKind.Credit;
      readonly blocks: number;
    }
  | {
      /** The consumer cannot go on, for these reasons; the render stops. */
      readonly kind: typeof BlockReplyKind.Refused;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };

function blockFrom(fields: MessageFields): readonly Float32Array[] {
  const channels = sampleArraysAt(fields, 'channels');
  const frames = channels[0]?.length;
  if (frames === undefined || channels.some((channel) => channel.length !== frames)) {
    throw new Malformed('channels', 'one or more sample arrays of one length');
  }
  return channels;
}

function messageFrom(fields: MessageFields): RenderedBlockMessage {
  const kind = oneOf(fields, 'kind', RenderedBlockKind);
  switch (kind) {
    case RenderedBlockKind.Block:
      return { kind, channels: blockFrom(fields) };
    case RenderedBlockKind.End:
      return { kind, frames: sampleCountAt(fields, 'frames') };
    case RenderedBlockKind.Failed:
      return { kind, failures: domainFailuresAt(fields, 'failures') };
  }
}

function replyFrom(fields: MessageFields): RenderedBlockReply {
  const kind = oneOf(fields, 'kind', BlockReplyKind);
  switch (kind) {
    case BlockReplyKind.Credit:
      return { kind, blocks: countAt(fields, 'blocks') };
    case BlockReplyKind.Refused:
      return { kind, failures: domainFailuresAt(fields, 'failures') };
  }
}

/** A message the render side sent, read, or why it cannot be. */
export function readRenderedBlockMessage(value: unknown): DomainResult<RenderedBlockMessage> {
  return readMessage(value, 'render.block-message-malformed', messageFrom);
}

/** A message the consumer sent, read, or why it cannot be. */
export function readRenderedBlockReply(value: unknown): DomainResult<RenderedBlockReply> {
  return readMessage(value, 'render.block-reply-malformed', replyFrom);
}
