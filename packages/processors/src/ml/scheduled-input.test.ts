import { describe, expect, it } from 'vitest';

import { succeed } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { ChunkSchedule, ScheduledRun } from './chunk-schedule.js';
import { ScheduledInput, type RunOver } from './scheduled-input.js';

/** Context on both sides, the first run keeping its context before: runs of 10 from 0, 6, 12… */
const CENTRED: ChunkSchedule = { chunk: 6, before: 2, after: 2, firstChunk: 8 };

/** Butted runs that hear an overlap past their chunk, as an overlapping transform's frames do. */
const BUTTED: ChunkSchedule = { chunk: 6, before: 0, after: 3, firstChunk: 6 };

/** A run as the stream was given it: which run, what it heard, and what of it lies in the stream. */
interface Heard {
  readonly first: number;
  readonly samples: readonly number[];
  readonly from: number;
  readonly count: number;
}

/** Each sample its own index plus one, so where a run's samples came from shows. */
function ramp(length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => index + 1);
}

/** Feeds `length` samples of a ramp to `input` in pieces of `piece`, then ends it, recording every run. */
async function runsOf(input: ScheduledInput, length: number, piece: number): Promise<Heard[]> {
  const heard: Heard[] = [];
  const record: RunOver = (run: ScheduledRun, channels) => {
    const { from, count } = input.part(run);
    heard.push({ first: run.first, samples: [...(channels[0] ?? [])], from, count });
    return Promise.resolve(succeed(undefined));
  };
  const signal = ramp(length);
  for (let start = 0; start < length; start += piece) {
    const frames = Math.min(piece, length - start);
    expectSuccess(await input.hear([signal.subarray(start, start + frames)], frames, record));
  }
  expectSuccess(await input.end(record));
  return heard;
}

describe('a scheduled input', () => {
  it('gives each run its samples once they are whole, then the rest with silence past the end', async () => {
    const heard = await runsOf(new ScheduledInput(CENTRED, 1), 17, 4);
    expect(heard).toEqual([
      { first: 0, samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], from: 0, count: 8 },
      { first: 6, samples: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16], from: 2, count: 6 },
      { first: 12, samples: [13, 14, 15, 16, 17, 0, 0, 0, 0, 0], from: 2, count: 3 },
    ]);
  });

  it('gives the same runs however the stream is read in pieces', async () => {
    const whole = await runsOf(new ScheduledInput(CENTRED, 1), 23, 23);
    for (const piece of [1, 3, 7, 10]) {
      expect(await runsOf(new ScheduledInput(CENTRED, 1), 23, piece)).toEqual(whole);
    }
  });

  it('runs no run that keeps no sample of the stream, and none for an empty stream', async () => {
    // Sample 14 is the last the second run keeps, so a stream of 14 needs no third.
    expect((await runsOf(new ScheduledInput(CENTRED, 1), 14, 5)).map(({ first }) => first)).toEqual(
      [0, 6],
    );
    expect(await runsOf(new ScheduledInput(CENTRED, 1), 0, 1)).toEqual([]);
    expect(await runsOf(new ScheduledInput(BUTTED, 1, 4), 0, 1)).toEqual([]);
  });

  it('hears the silence before the stream first, keeping none of it, and counts runs from it', async () => {
    const heard = await runsOf(new ScheduledInput(BUTTED, 1, 4), 9, 2);
    expect(heard).toEqual([
      { first: 0, samples: [0, 0, 0, 0, 1, 2, 3, 4, 5], from: 4, count: 2 },
      { first: 6, samples: [3, 4, 5, 6, 7, 8, 9, 0, 0], from: 0, count: 6 },
      { first: 12, samples: [9, 0, 0, 0, 0, 0, 0, 0, 0], from: 0, count: 1 },
    ]);
  });

  it('hears a channel the input lacks as silence, every channel in step', async () => {
    const input = new ScheduledInput(BUTTED, 2);
    const channels: number[][][] = [];
    const record: RunOver = (_run, given) => {
      channels.push(given.map((channel) => [...channel]));
      return Promise.resolve(succeed(undefined));
    };
    expectSuccess(await input.hear([ramp(9)], 9, record));
    expect(channels).toEqual([[[1, 2, 3, 4, 5, 6, 7, 8, 9], new Array<number>(9).fill(0)]]);
  });
});
