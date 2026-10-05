import { describe, expect, it } from 'vitest';

import {
  Cancelled,
  StandardLayouts,
  ZERO_SAMPLES,
  createCancellationSource,
  sampleCount,
  sampleRate,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId } from '@audiogubbins/audio-graph';
import {
  allocateBlock,
  memorySource,
  type AudioFrameBlock,
  type PcmSource,
} from '@audiogubbins/audio-engine';

import { ToProcessorFeedKind, type ToProcessorFeed } from '../protocol/feed-messages.js';
import {
  PostedDestination,
  RingDestination,
  startFeedPump,
  type FeedDestination,
  type FeedPump,
} from './feed-pump.js';
import type { Schedule } from '../schedule.js';
import { RingReader, RingWriter, createSampleRing } from './sample-ring.js';

const RATE = expectSuccess(sampleRate(48_000));
const STEREO = StandardLayouts.stereo;
const NODE = expectSuccess(nodeId('in'));

/** Ten milliseconds at 48 kHz: 480 frames ahead, which chunks of 128 fill three at a time. */
const AHEAD_MILLISECONDS = 10;
const AHEAD_FRAMES = 480;
const CHUNK = 128;

/** How long a full queue waits before it looks again. */
const WAKE_MILLISECONDS = 2.5;

/** A signal whose channels differ, exact in f32. */
function audio(frames: number): AudioFrameBlock {
  const block = allocateBlock(STEREO, RATE, frames);
  block.channels.forEach((channel, index) => {
    for (let frame = 0; frame < frames; frame += 1) channel[frame] = (index + 1) * 100_000 + frame;
  });
  return block;
}

/** A scheduler that runs its callbacks only when the test says. */
function fakeScheduler(): {
  schedule: Schedule;
  pending: () => number;
  delays: number[];
  fire: () => void;
} {
  const pending = new Set<() => void>();
  const delays: number[] = [];
  return {
    schedule: (callback, delayMs) => {
      pending.add(callback);
      delays.push(delayMs);
      return () => pending.delete(callback);
    },
    pending: () => pending.size,
    delays,
    fire: () => {
      const due = [...pending];
      pending.clear();
      for (const callback of due) callback();
    },
  };
}

/** Lets every read the pump started finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A source that counts its releases, which the pump must never make. */
function counted(block: AudioFrameBlock): { source: PcmSource; released: () => number } {
  let released = 0;
  const source = expectSuccess(memorySource(block));
  return {
    source: {
      ...source,
      release: () => {
        released += 1;
      },
    },
    released: () => released,
  };
}

function pumpOf(
  source: PcmSource,
  destination: FeedDestination,
  schedule: Schedule,
  signal = createCancellationSource().signal,
  start = ZERO_SAMPLES,
): FeedPump {
  return expectSuccess(
    startFeedPump({
      source,
      start,
      destination,
      feedAheadMilliseconds: AHEAD_MILLISECONDS,
      chunkFrames: CHUNK,
      wakeMilliseconds: WAKE_MILLISECONDS,
      schedule,
      signal,
    }),
  );
}

interface Posted {
  readonly message: ToProcessorFeed;
  readonly transfer: ArrayBuffer[];
}

function postedChannels(posts: readonly Posted[]): Float32Array[] {
  const blocks = posts.flatMap(({ message }) =>
    message.kind === ToProcessorFeedKind.Block ? [message.channels] : [],
  );
  return [0, 1].map((channel) => {
    const parts = blocks.map((block) => block[channel] ?? new Float32Array(0));
    const whole = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
    let at = 0;
    for (const part of parts) {
      whole.set(part, at);
      at += part.length;
    }
    return whole;
  });
}

describe('the feed pump into a ring', () => {
  it('keeps at most its time ahead queued, tops up on its timer, and ends the ring', async () => {
    const memory = expectSuccess(createSampleRing(2, 2_048));
    const writer = expectSuccess(RingWriter.open(memory));
    const reader = expectSuccess(RingReader.open(memory));
    const scheduler = fakeScheduler();
    const { source, released } = counted(audio(1_000));
    const pump = pumpOf(source, new RingDestination(writer, STEREO, RATE), scheduler.schedule);
    await settle();
    // Three chunks fit in the 480 frames ahead; a fourth would pass them.
    expect(writer.queued).toBe(384);
    expect(scheduler.pending()).toBe(1);
    expect(scheduler.delays[0]).toBe(WAKE_MILLISECONDS);

    const collected = [new Float32Array(1_000), new Float32Array(1_000)];
    let read = 0;
    let ended = false;
    void pump.done.then(() => {
      ended = true;
    });
    for (let turn = 0; (!reader.ended || read < 1_000) && turn < 1_000; turn += 1) {
      const into = allocateBlock(STEREO, RATE, 200);
      const got = reader.read(into);
      into.channels.forEach((channel, index) =>
        collected[index]?.set(channel.subarray(0, got), read),
      );
      read += got;
      scheduler.fire();
      await settle();
      expect(writer.queued).toBeLessThanOrEqual(AHEAD_FRAMES);
    }
    expect(collected).toEqual(audio(1_000).channels);
    expect(ended).toBe(true);
    expect(scheduler.pending()).toBe(0);
    expect(released()).toBe(0);
  });

  it('reads the source from the start frame it is given', async () => {
    const memory = expectSuccess(createSampleRing(2, 2_048));
    const writer = expectSuccess(RingWriter.open(memory));
    const reader = expectSuccess(RingReader.open(memory));
    pumpOf(
      counted(audio(1_000)).source,
      new RingDestination(writer, STEREO, RATE),
      fakeScheduler().schedule,
      createCancellationSource().signal,
      expectSuccess(sampleCount(900)),
    );
    await settle();
    const into = allocateBlock(STEREO, RATE, 200);
    expect(reader.read(into)).toBe(100);
    expect(into.channels[0]?.subarray(0, 100)).toEqual(audio(1_000).channels[0]?.subarray(900));
  });
});

describe('the feed pump by message', () => {
  it('counts what it sent against what the processor read, and never sends past its time ahead', async () => {
    const posts: Posted[] = [];
    const scheduler = fakeScheduler();
    const destination = new PostedDestination(NODE, STEREO, RATE, (message, transfer) => {
      posts.push({ message, transfer });
    });
    const pump = pumpOf(counted(audio(1_000)).source, destination, scheduler.schedule);
    await settle();
    expect(posts).toHaveLength(3);
    let consumed = 0;
    while (posts.at(-1)?.message.kind !== ToProcessorFeedKind.End) {
      // The processor says it read each block whole, one at a time.
      const read = posts.filter(({ message }) => message.kind === ToProcessorFeedKind.Block)[
        consumed / CHUNK
      ];
      const frames =
        read?.message.kind === ToProcessorFeedKind.Block
          ? (read.message.channels[0]?.length ?? 0)
          : 0;
      consumed += frames;
      destination.consumed(frames);
      pump.wake();
      await settle();
      const sent = postedChannels(posts)[0]?.length ?? 0;
      expect(sent - consumed).toBeLessThanOrEqual(AHEAD_FRAMES);
    }
    await pump.done;
    expect(postedChannels(posts)).toEqual(audio(1_000).channels);
    for (const { message, transfer } of posts) {
      if (message.kind !== ToProcessorFeedKind.Block) continue;
      // Each block's memory is transferred, never copied.
      expect(transfer).toEqual(message.channels.map((channel) => channel.buffer));
      expect(message.node).toBe(NODE);
    }
  });

  it('tops up at once when woken with room, without waiting for its timer', async () => {
    const posts: Posted[] = [];
    const scheduler = fakeScheduler();
    const destination = new PostedDestination(NODE, STEREO, RATE, (message, transfer) => {
      posts.push({ message, transfer });
    });
    const pump = pumpOf(counted(audio(10_000)).source, destination, scheduler.schedule);
    await settle();
    expect(destination.queued).toBe(384);
    destination.consumed(CHUNK);
    pump.wake();
    await settle();
    expect(destination.queued).toBe(384);
    expect(posts).toHaveLength(4);
  });

  it('refuses a time ahead that would need more blocks queued than a posted feed holds', () => {
    const destination = new PostedDestination(NODE, STEREO, RATE, () => undefined);
    const options = {
      source: counted(audio(10)).source,
      start: ZERO_SAMPLES,
      destination,
      feedAheadMilliseconds: 1_000,
      chunkFrames: CHUNK,
      wakeMilliseconds: WAKE_MILLISECONDS,
      schedule: fakeScheduler().schedule,
      signal: createCancellationSource().signal,
    };
    expect(expectFailureCode(startFeedPump(options))).toBe('feed.pump-invalid');
    expectSuccess(startFeedPump({ ...options, chunkFrames: 4_096 }));
    expect(expectFailureCode(startFeedPump({ ...options, chunkFrames: 0 }))).toBe(
      'feed.pump-invalid',
    );
  });
});

describe('stopping the feed pump', () => {
  it('stops on cancellation, rejecting with Cancelled and leaving no timer behind', async () => {
    const posts: ToProcessorFeed[] = [];
    const scheduler = fakeScheduler();
    const cancellation = createCancellationSource();
    const destination = new PostedDestination(NODE, STEREO, RATE, (message) => {
      posts.push(message);
    });
    const pump = pumpOf(
      counted(audio(10_000)).source,
      destination,
      scheduler.schedule,
      cancellation.signal,
    );
    await settle();
    expect(scheduler.pending()).toBe(1);
    cancellation.cancel();
    await expect(pump.done).rejects.toBeInstanceOf(Cancelled);
    expect(scheduler.pending()).toBe(0);
    const sent = posts.length;
    destination.consumed(384);
    pump.wake();
    scheduler.fire();
    await settle();
    expect(posts).toHaveLength(sent);
  });

  it('rejects with the error of a read that failed, and says no end', async () => {
    const posts: ToProcessorFeed[] = [];
    const failing: PcmSource = {
      ...counted(audio(10)).source,
      read: () => Promise.reject(new Error('The disk went away.')),
    };
    const pump = pumpOf(
      failing,
      new PostedDestination(NODE, STEREO, RATE, (message) => {
        posts.push(message);
      }),
      fakeScheduler().schedule,
    );
    await expect(pump.done).rejects.toThrow('The disk went away.');
    expect(posts).toHaveLength(0);
  });
});
