import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId } from '@audiogubbins/audio-graph';

import {
  FromProcessorFeedKind,
  ToProcessorFeedKind,
  readFromProcessorFeed,
  readToProcessorFeed,
  type ToProcessorFeed,
} from './feed-messages.js';

const IN = expectSuccess(nodeId('in'));

/** One message of every kind the feeder sends the processor. */
const EVERY_TO_PROCESSOR: readonly ToProcessorFeed[] = [
  { kind: ToProcessorFeedKind.Rewind, epoch: 4 },
  {
    kind: ToProcessorFeedKind.Block,
    node: IN,
    channels: [Float32Array.of(0.5, -0.25), Float32Array.of(1, 0)],
  },
  { kind: ToProcessorFeedKind.End, node: IN },
];

/**
 * A message with its sample arrays as lists of numbers. A structured clone
 * makes a typed array of the test's own realm, which the reader accepts by
 * its tag and Vitest's equality refuses by its prototype, so the values are
 * compared.
 */
function comparable(message: ToProcessorFeed): unknown {
  return message.kind === ToProcessorFeedKind.Block
    ? { ...message, channels: message.channels.map((channel) => Array.from(channel)) }
    : message;
}

/** The summary a malformed message is refused with. */
function refusal(
  result: ReturnType<typeof readToProcessorFeed | typeof readFromProcessorFeed>,
): string {
  if (result.ok) throw new Error('The message was read, and should have been refused.');
  return result.failures[0].summary;
}

describe('the feed channel’s protocol', () => {
  it.each(EVERY_TO_PROCESSOR.map((message) => [message.kind, message] as const))(
    'reads a %s message the feeder sends as it was sent, after a structured clone',
    (_kind, message) => {
      expect(comparable(expectSuccess(readToProcessorFeed(structuredClone(message))))).toEqual(
        comparable(message),
      );
    },
  );

  it('reads the processor’s word that it consumed a block, after a structured clone', () => {
    const consumed = { kind: FromProcessorFeedKind.Consumed, epoch: 4, node: IN, frames: 1_280 };
    expect(expectSuccess(readFromProcessorFeed(structuredClone(consumed)))).toEqual(consumed);
  });

  it.each([
    ['no kind', {}, 'kind'],
    ['a rewind without its epoch', { kind: 'rewind' }, 'epoch'],
    ['a block of numbers', { kind: 'feed-block', node: 'in', channels: [[0.5]] }, 'channels'],
    ['an end of no node', { kind: 'feed-end', node: '' }, 'node'],
    ['a command, which comes from the main thread', { kind: 'start', run: 1 }, 'kind'],
  ])('refuses a message to the processor with %s, naming the field', (_case, value, field) => {
    const read = readToProcessorFeed(value);
    expect(expectFailureCode(read)).toBe('protocol.feed-message-malformed');
    expect(refusal(read)).toContain(`message's ${field} is not`);
  });

  it.each([
    ['a fractional count', { kind: 'consumed', epoch: 1, node: 'in', frames: 0.5 }, 'frames'],
    ['no epoch', { kind: 'consumed', node: 'in', frames: 128 }, 'epoch'],
  ])('refuses a message from the processor with %s, naming the field', (_case, value, field) => {
    const read = readFromProcessorFeed(value);
    expect(expectFailureCode(read)).toBe('protocol.feed-reply-malformed');
    expect(refusal(read)).toContain(`message's ${field} is not`);
  });
});
