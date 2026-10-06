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

/**
 * A chain that holds the first frame of each block of {@link GRID} frames,
 * counted from its own first frame, as a spectral processor frames its input
 * from where it starts: started off the grid, it holds other frames.
 */
const HOLDING: ChainProcessing = {
  prepare: () => {
    let counted = 0;
    let held = 0;
    const run: ChainRun = {
      latency: 0,
      layout: StandardLayouts.mono,
      leadIn: LEAD_IN,
      frameGrid: GRID,
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
    const whole = [new Float32Array(LENGTH)];
    await content(ProcessedStart.Canonical).processed.read(0, LENGTH, whole);
    const { processed, reads } = content(ProcessedStart.Preview);
    const late = [new Float32Array(500)];
    await processed.read(1_000, 500, late);
    // 1,000 less the lead-in is 900, and the grid frame at or before it is 896.
    expect(reads[0]).toBe(896);
    expect(late[0]).toEqual(whole[0]?.subarray(1_000, 1_500));
  });
});
