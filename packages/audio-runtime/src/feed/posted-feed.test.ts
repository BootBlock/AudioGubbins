import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { allocateBlock } from '@audiogubbins/audio-engine';

import { POSTED_FEED_BLOCKS, PostedFeed } from './posted-feed.js';

const RATE = expectSuccess(sampleRate(48_000));
const STEREO = StandardLayouts.stereo;

/** Frames `[start, start + frames)` of a signal whose channels differ, as a posted block's arrays. */
function posted(start: number, frames: number): Float32Array[] {
  return [0, 1].map((channel) =>
    Float32Array.from({ length: frames }, (_, frame) => (channel + 1) * 100_000 + start + frame),
  );
}

describe('a posted feed', () => {
  it('fills quanta from blocks of other sizes in order, across their boundaries', () => {
    const feed = new PostedFeed(STEREO);
    let start = 0;
    for (const frames of [100, 37, 250, 1, 124]) {
      expectSuccess(feed.push(posted(start, frames)));
      start += frames;
    }
    const collected = [new Float32Array(512), new Float32Array(512)];
    const into = allocateBlock(STEREO, RATE, 128);
    for (let quantum = 0; quantum < 4; quantum += 1) {
      expect(feed.fill(into)).toBe(128);
      into.channels.forEach((channel, index) => collected[index]?.set(channel, quantum * 128));
    }
    expect(collected).toEqual(posted(0, 512));
  });

  it('counts an underrun while it has not ended, and the end once it has', () => {
    const feed = new PostedFeed(STEREO);
    expectSuccess(feed.push(posted(0, 100)));
    const into = allocateBlock(STEREO, RATE, 128);
    feed.beginQuantum();
    expect(feed.fill(into)).toBe(100);
    expect(feed.shortFrames).toBe(28);
    feed.beginQuantum();
    expectSuccess(feed.push(posted(100, 50)));
    feed.end();
    expect(feed.fill(into)).toBe(50);
    expect(feed.shortFrames).toBe(0);
    expect(feed.suppliedFrames).toBe(50);
    expect(feed.finished).toBe(true);
  });

  it('refuses a block of another channel count, of ragged channels, or after the end', () => {
    const feed = new PostedFeed(STEREO);
    expect(expectFailureCode(feed.push([new Float32Array(4)]))).toBe('feed.block-refused');
    expect(expectFailureCode(feed.push([new Float32Array(4), new Float32Array(3)]))).toBe(
      'feed.block-refused',
    );
    feed.end();
    expect(expectFailureCode(feed.push(posted(0, 4)))).toBe('feed.block-refused');
  });

  it('holds a bounded number of blocks, and refuses one past the bound', () => {
    const feed = new PostedFeed(STEREO);
    for (let block = 0; block < POSTED_FEED_BLOCKS; block += 1) {
      expectSuccess(feed.push(posted(block, 1)));
    }
    expect(expectFailureCode(feed.push(posted(0, 1)))).toBe('feed.block-refused');
    // An empty block takes no place, so it is not refused.
    expectSuccess(feed.push([new Float32Array(0), new Float32Array(0)]));
    feed.fill(allocateBlock(STEREO, RATE, 1));
    expectSuccess(feed.push(posted(0, 1)));
  });

  it('drops its queued blocks and its end when cleared', () => {
    const feed = new PostedFeed(STEREO);
    expectSuccess(feed.push(posted(0, 300)));
    feed.end();
    feed.clear();
    const into = allocateBlock(STEREO, RATE, 128);
    expect(feed.fill(into)).toBe(0);
    expect(feed.finished).toBe(false);
    expectSuccess(feed.push(posted(1_000, 128)));
    expect(feed.fill(into)).toBe(128);
    expect(into.channels).toEqual(posted(1_000, 128));
  });
});
