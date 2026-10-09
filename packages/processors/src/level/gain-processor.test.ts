import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { sine } from '@audiogubbins/test-fixtures';

import {
  TEST_BLOCK_FRAMES,
  TEST_RATE,
  processorKernel,
  runProcessor,
} from '../testing/processor-run.js';
import { GAIN_PROCESSOR } from './gain-processor.js';

describe('the gain processor', () => {
  it('raises a sine by the decibels asked for, as the canonical conversion gives them', () => {
    const input = [sine(1_000, { amplitude: 0.25 }).channels[0] ?? new Float32Array(0)];
    const [louder] = runProcessor(
      GAIN_PROCESSOR,
      { layout: StandardLayouts.mono, values: { gain: 6 } },
      input,
    );
    const ratio = (louder?.[1_234] ?? 0) / (input[0]?.[1_234] ?? 1);
    expect(ratio).toBeCloseTo(10 ** (6 / 20), 6);
  });

  it('moves to a new level while it plays over a ramp, not in one step', () => {
    const { kernel } = processorKernel(GAIN_PROCESSOR, { layout: StandardLayouts.mono });
    // One block, the most a kernel is given at a time, and longer than the ramp.
    const frames = TEST_BLOCK_FRAMES;
    const ones = new Float32Array(frames).fill(1);
    const out = new Float32Array(frames);
    const block = (channels: Float32Array[]) => ({
      layout: StandardLayouts.mono,
      sampleRate: TEST_RATE,
      frames,
      channels,
    });
    expect(kernel.setParameter('gain', -6).ok).toBe(true);
    kernel.process([block([ones])], [block([out])], frames);
    expect(out[0]).toBeGreaterThan(0.99);
    expect(out[frames - 1]).toBeCloseTo(10 ** (-6 / 20), 6);
    expect(out[10]).toBeLessThan(out[0] ?? 0);
  });
});
