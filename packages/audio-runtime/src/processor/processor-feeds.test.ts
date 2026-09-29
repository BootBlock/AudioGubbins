import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId } from '@audiogubbins/audio-graph';
import { allocateBlock } from '@audiogubbins/audio-engine';
import { allocatedBy, type Run } from '@audiogubbins/audio-engine/testing';

import { POSTED_FEED_BLOCKS, PostedFeed } from '../feed/posted-feed.js';
import { FromProcessorFeedKind, type FromProcessorFeed } from '../protocol/feed-messages.js';
import { ProcessorFeeds } from './processor-feeds.js';

const STEREO = StandardLayouts.stereo;
const RATE = expectSuccess(sampleRate(48_000));
const QUANTUM = 128;
const IN = expectSuccess(nodeId('in'));

/** Feeds bound to one posted feed, and every answer they send, as the feeder receives it. */
function postedFeeds(): {
  readonly feeds: ProcessorFeeds;
  readonly feed: PostedFeed;
  readonly heard: FromProcessorFeed[];
} {
  const feed = new PostedFeed(STEREO);
  const heard: FromProcessorFeed[] = [];
  // A post clones what it is given, so the answer is kept as it was then.
  const feeds = new ProcessorFeeds((message) => heard.push({ ...message }));
  feeds.bind({ feeds: [feed], posted: new Map([[IN, feed]]) });
  return { feeds, feed, heard };
}

describe('the answer about a posted feed’s blocks', () => {
  it('is sent in the quantum each block is read whole, naming the run', () => {
    const { feeds, feed, heard } = postedFeeds();
    feeds.rewind(3);
    const block = [new Float32Array(QUANTUM * 2), new Float32Array(QUANTUM * 2)];
    expectSuccess(feed.push(block));
    expectSuccess(feed.push(block));
    const into = allocateBlock(STEREO, RATE, QUANTUM);

    const quanta = [1, 2, 3].map(() => {
      feeds.beginQuantum();
      feed.fill(into);
      feeds.supplied();
      return heard.length;
    });

    // The first block is read whole in the second quantum, the next in the fourth.
    expect(quanta).toEqual([0, 1, 1]);
    expect(heard).toEqual([
      { kind: FromProcessorFeedKind.Consumed, epoch: 3, node: IN, frames: QUANTUM * 2 },
    ]);
  });

  it('allocates nothing on the audio thread, a block read whole every quantum', () => {
    const feed = new PostedFeed(STEREO);
    let answers = 0;
    // Counts the posts, as the channel's post clones each, keeping nothing.
    const feeds = new ProcessorFeeds(() => {
      answers += 1;
    });
    feeds.bind({ feeds: [feed], posted: new Map([[IN, feed]]) });
    const block = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    const into = allocateBlock(STEREO, RATE, QUANTUM);
    const run: Run = {
      // Queued outside the measurement: a block arrives as a message, which
      // is allocated wherever it is received.
      prepare: () => {
        feed.clear();
        for (let queued = 0; queued < POSTED_FEED_BLOCKS; queued += 1) {
          expectSuccess(feed.push(block));
        }
      },
      quantum: () => {
        feeds.beginQuantum();
        feed.fill(into);
        feeds.supplied();
      },
      quanta: POSTED_FEED_BLOCKS,
    };

    const allocated = allocatedBy(run);

    expect(answers).toBeGreaterThan(POSTED_FEED_BLOCKS);
    expect(allocated).toBeLessThan(POSTED_FEED_BLOCKS);
  });
});
