/**
 * The messages between the feeder worker and the engine's AudioWorklet
 * processor, on the channel whose two ends the main thread hands them.
 *
 * The audio of every graph input crosses here, not through the main thread, so
 * no long task there can starve the audio thread (REQ-ARCH-036): a shared
 * ring's audio is written in place and only its rewinds are sent, and a posted
 * feed's blocks are sent one by one, each answered once the graph input has
 * read it, which is how the feeder knows how much the processor holds. Both
 * travel on the one channel, so a rewind is never overtaken by the audio that
 * follows it, whose arrival order is all that keeps the old position's audio
 * from being heard at the new one.
 */

import {
  countAt,
  oneOf,
  readMessage,
  sampleArraysAt,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';

import { nodeAt } from './message-reading.js';

/** The kinds of message the feeder sends the processor. */
export const ToProcessorFeedKind = {
  Rewind: 'rewind',
  Block: 'feed-block',
  End: 'feed-end',
} as const;

/** A message the feeder sends the processor. */
export type ToProcessorFeed =
  | {
      /**
       * Every feed's audio from here on is run `epoch`'s: what the feeds held
       * before is discarded, a ring's up to the mark the feeder set before it
       * sent this, and the processor halts, since what it would play next
       * belongs to a position it has left.
       */
      readonly kind: typeof ToProcessorFeedKind.Rewind;
      readonly epoch: number;
    }
  | {
      /** The next block of a posted feed, one array per channel, transferred. */
      readonly kind: typeof ToProcessorFeedKind.Block;
      readonly node: NodeId;
      readonly channels: readonly Float32Array[];
    }
  | {
      /** A posted feed has no more audio after what it has sent. */
      readonly kind: typeof ToProcessorFeedKind.End;
      readonly node: NodeId;
    };

/** The kinds of message the processor sends the feeder. */
export const FromProcessorFeedKind = {
  Consumed: 'consumed',
} as const;

/** A message the processor sends the feeder. */
export type FromProcessorFeed = {
  /**
   * The graph input read the whole of a posted block of `frames` frames of
   * epoch `epoch`, so the feed has room for as many more. An answer about an
   * epoch since rewound is about audio discarded, and counts for nothing.
   */
  readonly kind: typeof FromProcessorFeedKind.Consumed;
  readonly epoch: number;
  readonly node: NodeId;
  readonly frames: number;
};

function toProcessorFeedFrom(fields: MessageFields): ToProcessorFeed {
  const kind = oneOf(fields, 'kind', ToProcessorFeedKind);
  switch (kind) {
    case ToProcessorFeedKind.Rewind:
      return { kind, epoch: countAt(fields, 'epoch') };
    case ToProcessorFeedKind.Block:
      return { kind, node: nodeAt(fields, 'node'), channels: sampleArraysAt(fields, 'channels') };
    case ToProcessorFeedKind.End:
      return { kind, node: nodeAt(fields, 'node') };
  }
}

function fromProcessorFeedFrom(fields: MessageFields): FromProcessorFeed {
  return {
    kind: oneOf(fields, 'kind', FromProcessorFeedKind),
    epoch: countAt(fields, 'epoch'),
    node: nodeAt(fields, 'node'),
    frames: countAt(fields, 'frames'),
  };
}

/** A message the processor received from the feeder, read, or why it cannot be. */
export function readToProcessorFeed(value: unknown): DomainResult<ToProcessorFeed> {
  return readMessage(value, 'protocol.feed-message-malformed', toProcessorFeedFrom);
}

/** A message the feeder received from the processor, read, or why it cannot be. */
export function readFromProcessorFeed(value: unknown): DomainResult<FromProcessorFeed> {
  return readMessage(value, 'protocol.feed-reply-malformed', fromProcessorFeedFrom);
}
