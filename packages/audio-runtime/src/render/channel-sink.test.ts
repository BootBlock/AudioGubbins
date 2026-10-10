/**
 * A channel sink on its own, over a real message channel: it sends nothing,
 * its end included, past the credit its receiver granted.
 */

import {
  StandardLayouts,
  createCancellationSource,
  sampleCount,
  sampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { frameBlock } from '@audiogubbins/audio-engine';
import { readRenderedStreamMessage, type RenderedStreamMessage } from '@audiogubbins/import-export';
import { describe, expect, it } from 'vitest';

import { ChannelSink } from './channel-sink.js';

const block = () =>
  expectSuccess(
    frameBlock(StandardLayouts.mono, expectSuccess(sampleRate(48_000)), [new Float32Array(8)]),
  );

/** Lets the channel's messages arrive. */
const turn = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('a channel sink', () => {
  it('waits for credit before each block and before its end', async () => {
    const channel = new MessageChannel();
    const received: RenderedStreamMessage[] = [];
    channel.port2.addEventListener('message', (event: MessageEvent) => {
      received.push(expectSuccess(readRenderedStreamMessage(event.data)));
    });
    channel.port2.start();
    const sink = new ChannelSink(channel.port1, createCancellationSource().signal);
    channel.port2.postMessage({ kind: 'ready', credit: 1 });

    const first = sink.write(block());
    await first;
    let secondWritten = false;
    const second = sink.write(block()).then(() => {
      secondWritten = true;
    });
    await turn();
    await turn();
    expect(received.map((message) => message.kind)).toEqual(['block']);
    expect(secondWritten).toBe(false);

    channel.port2.postMessage({ kind: 'ready', credit: 1 });
    await second;
    let ended = false;
    const ending = sink.end(expectSuccess(sampleCount(16))).then(() => {
      ended = true;
    });
    await turn();
    await turn();
    expect(received.map((message) => message.kind)).toEqual(['block', 'block']);
    expect(ended).toBe(false);

    channel.port2.postMessage({ kind: 'ready', credit: 1 });
    await ending;
    for (let wait = 0; wait < 20 && received.length < 3; wait += 1) await turn();
    expect(received.at(-1)).toEqual({ kind: 'end', frames: 16 });
  });
});
