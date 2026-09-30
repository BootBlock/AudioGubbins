import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { allocateBlock, type AudioFrameBlock } from '@audiogubbins/audio-engine';

import { RingFeed } from './ring-feed.js';
import { RingReader, RingWriter, createSampleRing } from './sample-ring.js';

const RATE = expectSuccess(sampleRate(48_000));
const STEREO = StandardLayouts.stereo;

function constant(frames: number, value: number): AudioFrameBlock {
  const block = allocateBlock(STEREO, RATE, frames);
  for (const channel of block.channels) channel.fill(value);
  return block;
}

function feedOverRing(): { writer: RingWriter; feed: RingFeed } {
  const memory = expectSuccess(createSampleRing(2, 512));
  return {
    writer: expectSuccess(RingWriter.open(memory)),
    feed: new RingFeed(expectSuccess(RingReader.open(memory)), STEREO),
  };
}

describe('a feed over a ring', () => {
  it('fills from the ring and counts the frames it supplied', () => {
    const { writer, feed } = feedOverRing();
    writer.write(constant(200, 0.5));
    const into = allocateBlock(STEREO, RATE, 128);
    expect(feed.fill(into)).toBe(128);
    expect(into.channels[1]?.every((sample) => sample === 0.5)).toBe(true);
    expect(feed.suppliedFrames).toBe(128);
    expect(feed.layout).toBe(STEREO);
  });

  it('is ready for a quantum only with a whole one written, or once its writer has ended', () => {
    const { writer, feed } = feedOverRing();
    writer.write(constant(100, 0.5));
    expect(feed.ready(128)).toBe(false);
    writer.write(constant(28, 0.5));
    expect(feed.ready(128)).toBe(true);
    const into = allocateBlock(STEREO, RATE, 128);
    feed.fill(into);
    expect(feed.ready(128)).toBe(false);
    writer.end();
    expect(feed.ready(128)).toBe(true);
  });

  it('is not ready for audio written past a discard mark until it is cleared', () => {
    const { writer, feed } = feedOverRing();
    writer.write(constant(64, 0.5));
    writer.discard();
    writer.write(constant(128, 0.25));
    expect(feed.ready(128)).toBe(false);
    feed.clear();
    expect(feed.ready(128)).toBe(true);
  });

  it('is finished when it runs out after its writer ended', () => {
    const { writer, feed } = feedOverRing();
    writer.write(constant(100, 0.5));
    writer.end();
    const into = allocateBlock(STEREO, RATE, 128);
    feed.beginQuantum();
    expect(feed.fill(into)).toBe(100);
    expect(feed.finished).toBe(true);
  });

  it('skips the marked audio and forgets its end when cleared', () => {
    const { writer, feed } = feedOverRing();
    writer.write(constant(100, 0.5));
    writer.end();
    const into = allocateBlock(STEREO, RATE, 128);
    feed.fill(into);
    writer.discard();
    writer.write(constant(128, 0.25));
    feed.clear();
    expect(feed.finished).toBe(false);
    expect(feed.fill(into)).toBe(128);
    expect(into.channels[0]?.every((sample) => sample === 0.25)).toBe(true);
  });
});
