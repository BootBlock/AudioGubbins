import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  sampleRate,
  succeed,
  unsafeBrandId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import type { ChainProcessing, ChainRun } from './chain-processing.js';
import { ProcessedContent, ProcessedStart } from './processed-content.js';

const RATE = expectSuccess(sampleRate(48_000));
const LENGTH = 4_000;
const GRID = 64;
const LEAD_IN = 100;

/** Each frame its own index, so every frame of output names the input frame it came from. */
const source = Float32Array.from({ length: LENGTH }, (_, frame) => frame);

/** The start of every run {@link HOLDING} was asked to prepare, in order. */
const STARTS: number[] = [];

/**
 * A chain that holds the first frame of each block of {@link GRID} frames,
 * counted from its own first frame, as a spectral processor frames its input
 * from where it starts: started off the grid, it holds other frames.
 */
const HOLDING: ChainProcessing = {
  listening: () => succeed({ kind: 'live', partWay: { leadIn: LEAD_IN, frameGrid: GRID } }),
  measurementBytes: () => succeed(0),
  prepareLive: () => {
    throw new Error('No live run is made while a stream is read.');
  },
  prepare: (request) => {
    STARTS.push(request.start);
    let counted = 0;
    let held = 0;
    const run: ChainRun = {
      latency: 0,
      layout: StandardLayouts.mono,
      process: (input, output, frames) => {
        for (let frame = 0; frame < frames; frame += 1, counted += 1) {
          if (counted % GRID === 0) held = input[0]?.[frame] ?? 0;
          const into = output[0];
          if (into !== undefined) into[frame] = held;
        }
      },
      setParameter: () => succeed(undefined),
      release: () => undefined,
    };
    return Promise.resolve(succeed(run));
  },
};

function content(start: ProcessedStart) {
  const reads: number[] = [];
  const processed = new ProcessedContent(
    { id: unsafeBrandId<'EffectChainId'>('00000000-c0de'), slots: [] },
    {
      layout: StandardLayouts.mono,
      sampleRate: RATE,
      length: LENGTH,
      read: (at, frames, into) => {
        reads.push(at);
        into[0]?.set(source.subarray(at, at + frames));
        return Promise.resolve();
      },
    },
    StandardLayouts.mono,
    { processing: HOLDING, quality: MAXIMUM_QUALITY.settings, start, dsp: REFERENCE_DSP },
  );
  return { processed, reads };
}

describe('a processed stream started part way through for a preview', () => {
  it('starts on the chain’s frame grid, at least its lead-in early, so it frames the audio as the render does', async () => {
    STARTS.length = 0;
    const whole = [new Float32Array(LENGTH)];
    await content(ProcessedStart.Canonical).processed.read(0, LENGTH, whole);
    const { processed, reads } = content(ProcessedStart.Preview);
    const late = [new Float32Array(500)];
    await processed.read(1_000, 500, late);
    // 1,000 less the lead-in is 900, and the grid frame at or before it is 896.
    expect(reads[0]).toBe(896);
    expect(late[0]).toEqual(whole[0]?.subarray(1_000, 1_500));
    // Each run is told where it starts, so one that plays back a whole pass
    // can play it from there.
    expect(STARTS).toEqual([0, 896]);
  });
});

/** Frames a delaying chain's output lags its input: more than one chunk the stream runs off at a time. */
const DELAY = 10_000;

/** Frames of a stream longer than the delay, each its own index. */
const LONG = Float32Array.from({ length: 3 * DELAY }, (_, frame) => frame);

/** A chain whose output is its input {@link DELAY} frames late, which its reader runs off and cuts. */
const DELAYING: ChainProcessing = {
  listening: () => succeed({ kind: 'live', partWay: { leadIn: 0, frameGrid: 1 } }),
  measurementBytes: () => succeed(0),
  prepareLive: () => {
    throw new Error('No live run is made while a stream is read.');
  },
  prepare: () => {
    const line = new Float32Array(DELAY);
    let at = 0;
    const run: ChainRun = {
      latency: DELAY,
      layout: StandardLayouts.mono,
      process: (input, output, frames) => {
        for (let frame = 0; frame < frames; frame += 1, at = (at + 1) % DELAY) {
          const into = output[0];
          if (into !== undefined) into[frame] = line[at] ?? 0;
          line[at] = input[0]?.[frame] ?? 0;
        }
      },
      setParameter: () => succeed(undefined),
      release: () => undefined,
    };
    return Promise.resolve(succeed(run));
  },
};

describe('a processed stream whose read fails while its run is primed', () => {
  it('primes a new run for the next read rather than counting the frames it ran off as given', async () => {
    let failAt: number | undefined = 4_096;
    const processed = new ProcessedContent(
      { id: unsafeBrandId<'EffectChainId'>('00000000-de1a'), slots: [] },
      {
        layout: StandardLayouts.mono,
        sampleRate: RATE,
        length: LONG.length,
        read: (at, frames, into) => {
          if (at === failAt) {
            failAt = undefined;
            return Promise.reject(new Error('The file went away.'));
          }
          into[0]?.set(LONG.subarray(at, at + frames));
          return Promise.resolve();
        },
      },
      StandardLayouts.mono,
      {
        processing: DELAYING,
        quality: MAXIMUM_QUALITY.settings,
        start: ProcessedStart.Canonical,
        dsp: REFERENCE_DSP,
      },
    );
    const first = [new Float32Array(500)];
    await expect(processed.read(3_000, 500, first)).rejects.toThrow('The file went away.');

    // At or past the frames the failed read ran off, a chunk, so only a run
    // that knows it was never primed starts again.
    const after = [new Float32Array(500)];
    await processed.read(4_500, 500, after);

    expect(after[0]).toEqual(LONG.subarray(4_500, 5_000));
  });
});
