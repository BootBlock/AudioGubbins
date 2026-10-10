/**
 * Reading a stream's message that crossed between workers, field by field
 * (REQ-EXEC-136.12): each receiver reads what arrives into its union before it
 * acts on it, and a malformed message is refused with the field that was
 * wrong, which ends the stream.
 *
 * A block's planes are one per channel, at least one and at most the domain's
 * channels, each exactly the block's frames long, so a receiver writes no
 * sample it was not sent and reads none past what it was.
 */

import {
  MAXIMUM_CHANNEL_COUNT,
  Malformed,
  bytesAt,
  countAt,
  domainFailureAt,
  fieldsAt,
  itemsAt,
  layoutOf,
  rateOf,
  readMessage,
  sampleArraysAt,
  sampleCountAt,
  sampleCountOf,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';
import { metadataMapOf, metadataPartOf, type FinishedAudioFile } from '@audiogubbins/codecs';

import type {
  DecodedStreamDescription,
  DecodedStreamMessage,
  EncodedStreamMessage,
  RenderedStreamMessage,
  StreamReceiverMessage,
} from './stream-messages.js';

/** The code every malformed stream message is refused with. */
const MALFORMED = 'import-export.stream-message-malformed';

/** A block of planar samples: one plane per channel, each `frames` long. */
function blockOf(fields: MessageFields): {
  readonly kind: 'block';
  readonly channels: readonly Float32Array[];
  readonly frames: number;
} {
  const channels = sampleArraysAt(fields, 'channels');
  const frames = countAt(fields, 'frames');
  if (channels.length === 0 || channels.length > MAXIMUM_CHANNEL_COUNT) {
    throw new Malformed('channels', `one to ${String(MAXIMUM_CHANNEL_COUNT)} planes`);
  }
  if (frames === 0 || channels.some((plane) => plane.length !== frames)) {
    throw new Malformed('channels', 'planes each of the block’s frames, at least one');
  }
  return { kind: 'block', channels, frames };
}

function descriptionOf(fields: MessageFields): DecodedStreamDescription {
  const statedFrames =
    fields['statedFrames'] === undefined
      ? undefined
      : sampleCountOf(fields['statedFrames'], 'description.statedFrames');
  return {
    sampleRate: rateOf(fields['sampleRate'], 'description.sampleRate'),
    layout: layoutOf(fields['layout'], 'description.layout'),
    statedFrames,
    metadata: metadataMapOf(fields['metadata'], 'description.metadata'),
  };
}

function finishedOf(fields: MessageFields): FinishedAudioFile {
  return {
    head: bytesAt(fields, 'head'),
    tail: bytesAt(fields, 'tail'),
    dropped: itemsAt(fields, 'dropped', metadataPartOf),
  };
}

/** The codec worker's message on a decoded import's channel. */
export function readDecodedStreamMessage(value: unknown): DomainResult<DecodedStreamMessage> {
  return readMessage(value, MALFORMED, (fields): DecodedStreamMessage => {
    switch (fields['kind']) {
      case 'description':
        return {
          kind: 'description',
          description: descriptionOf(fieldsAt(fields, 'description')),
        };
      case 'block':
        return blockOf(fields);
      case 'end':
        return { kind: 'end', frames: sampleCountAt(fields, 'frames') };
      case 'failed':
        return { kind: 'failed', failure: domainFailureAt(fields, 'failure') };
      default:
        throw new Malformed('kind', 'description, block, end or failed');
    }
  });
}

/** The codec worker's message on an encoded export's channel. */
export function readEncodedStreamMessage(value: unknown): DomainResult<EncodedStreamMessage> {
  return readMessage(value, MALFORMED, (fields): EncodedStreamMessage => {
    switch (fields['kind']) {
      case 'body':
        return { kind: 'body', bytes: bytesAt(fields, 'bytes') };
      case 'finished':
        return { kind: 'finished', file: finishedOf(fieldsAt(fields, 'file')) };
      case 'failed':
        return { kind: 'failed', failure: domainFailureAt(fields, 'failure') };
      default:
        throw new Malformed('kind', 'body, finished or failed');
    }
  });
}

/** The render worker's message on a rendered export's channel. */
export function readRenderedStreamMessage(value: unknown): DomainResult<RenderedStreamMessage> {
  return readMessage(value, MALFORMED, (fields): RenderedStreamMessage => {
    switch (fields['kind']) {
      case 'block':
        return blockOf(fields);
      case 'end':
        return { kind: 'end', frames: sampleCountAt(fields, 'frames') };
      case 'failed':
        return { kind: 'failed', failure: domainFailureAt(fields, 'failure') };
      default:
        throw new Malformed('kind', 'block, end or failed');
    }
  });
}

/** A receiver's message on any stream's channel: credit of at least one, or a refusal. */
export function readStreamReceiverMessage(value: unknown): DomainResult<StreamReceiverMessage> {
  return readMessage(value, MALFORMED, (fields): StreamReceiverMessage => {
    switch (fields['kind']) {
      case 'ready': {
        const credit = countAt(fields, 'credit');
        if (credit === 0) throw new Malformed('credit', 'credit for at least one message');
        return { kind: 'ready', credit };
      }
      case 'refused':
        return { kind: 'refused', failure: domainFailureAt(fields, 'failure') };
      default:
        throw new Malformed('kind', 'ready or refused');
    }
  });
}
