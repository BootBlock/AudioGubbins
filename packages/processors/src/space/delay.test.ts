import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { lastAudibleFrame } from '../testing/filter-measures.js';
import { DELAY } from './delay.js';
import { setLayout } from '../testing/space-measures.js';

/** Ten milliseconds, a whole 480 frames at the tests' rate. */
const D = 480;
const AT = 100;

/** `channels` channels of silence with a unit impulse at `AT` in channel `into`. */
function impulse(channels: number, into: number, length = 6_000): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) => {
    const samples = new Float32Array(length);
    if (channel === into) samples[AT] = 1;
    return samples;
  });
}

/** The sum of `samples` over the `D` frames of echo `k`, from its first frame. */
function echoSum(samples: Float32Array | undefined, k: number): number {
  let sum = 0;
  for (let frame = AT + k * D; frame < AT + (k + 1) * D; frame += 1) sum += samples?.[frame] ?? 0;
  return sum;
}

describe('the delay', () => {
  it('ping-pongs its echoes between two channels with cross-feed, each the feedback of the last', () => {
    const values = { time: 10, feedback: 50, damping: 20_000, 'cross-feed': true };
    const [left, right] = runProcessor(
      DELAY,
      { layout: StandardLayouts.stereo, values },
      impulse(2, 0),
    );
    expect(left?.[AT + D]).toBe(1);
    expect(echoSum(right, 1)).toBe(0);
    expect(echoSum(left, 2)).toBeCloseTo(0, 12);
    expect(echoSum(right, 2)).toBeCloseTo(0.5, 5);
    expect(echoSum(left, 3)).toBeCloseTo(0.25, 5);
    expect(echoSum(right, 3)).toBeCloseTo(0, 12);
  });

  it('feeds each channel of 5.1 into the next in layout order, the last into the first', () => {
    const values = { time: 10, feedback: 50, damping: 20_000, 'cross-feed': true };
    const out = runProcessor(
      DELAY,
      { layout: StandardLayouts.surround5_1, values },
      impulse(6, 4, 8_000),
    );
    // Echo 1 is the input's own channel, each later one the next channel round.
    for (const [k, channel] of [
      [1, 4],
      [2, 5],
      [3, 0],
      [4, 1],
    ] as const) {
      expect(echoSum(out[channel], k)).toBeCloseTo(0.5 ** (k - 1), 5);
    }
  });

  it('damps each echo it feeds back at high frequencies but keeps its DC', () => {
    const run = (damping: number) =>
      runProcessor(
        DELAY,
        { layout: StandardLayouts.mono, values: { time: 10, feedback: 80, damping } },
        impulse(1, 0),
      )[0];
    const bright = run(20_000);
    const dark = run(500);
    expect(echoSum(dark, 2)).toBeCloseTo(0.8, 4);
    expect(echoSum(bright, 2)).toBeCloseTo(0.8, 4);
    // Spread by the low-pass, the dark echo's first sample is a small part of it.
    expect(dark?.[AT + 2 * D] ?? 1).toBeLessThan(0.1 * (bright?.[AT + 2 * D] ?? 0));
  });

  it('moves its time while it plays to the same bits however the stream is cut', () => {
    const input = [noise(9, { length: 12_000 }).channels[0] ?? new Float32Array(0)];
    const settings = { layout: StandardLayouts.mono, values: { time: 20, feedback: 60 } };
    const change = { frame: 3_001, name: 'time', value: 33.3 };
    const [steady] = runProcessor(DELAY, settings, input, [4_096], change);
    const [cut] = runProcessor(DELAY, settings, input, [1, 7, 128, 333, 31], change);
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
    const [unmoved] = runProcessor(DELAY, settings, input);
    expect(unmoved?.slice(0, 3_001)).toEqual(steady?.slice(0, 3_001));
    expect(unmoved?.slice(3_100)).not.toEqual(steady?.slice(3_100));
  });

  it('falls silent within the lead-in it declares, and declares no latency', () => {
    for (const values of [
      { time: 10, feedback: 90, damping: 300 },
      { time: 3, feedback: 95, damping: 20_000 },
      { time: 50, feedback: 0 },
    ]) {
      const settings = {
        values: processorValues(DELAY, values),
        sampleRate: TEST_RATE,
        quality: MAXIMUM_QUALITY.settings,
      };
      const leadIn = DELAY.descriptor.leadIn(settings);
      const [response = new Float32Array(0)] = runProcessor(
        DELAY,
        { layout: StandardLayouts.mono, values },
        [impulse(1, 0, leadIn + 4_000)[0] ?? new Float32Array(0)],
      );
      expect(lastAudibleFrame(response) - AT).toBeLessThanOrEqual(leadIn);
      expect(DELAY.descriptor.latency(settings)).toEqual({ kind: 'known', frames: 0 });
    }
  });

  it('refuses cross-feed on an ambisonic set, a time outside its range, and a toggle while it runs', () => {
    const ambisonic = setLayout(1, 'sn3d');
    const crossing = processorValues(DELAY, { 'cross-feed': true });
    const refused = DELAY.descriptor.outputLayout(ambisonic, crossing);
    expect(expectFailureCode(refused)).toBe('processor.layout-refused');
    expect(expectSuccess(DELAY.descriptor.outputLayout(ambisonic, processorValues(DELAY)))).toBe(
      ambisonic,
    );
    const { kernel } = processorKernel(DELAY, { layout: StandardLayouts.stereo });
    expect(expectFailureCode(kernel.setParameter('time', 5_000))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('cross-feed', 1))).toBe('node.parameter-unknown');
    expect(kernel.setParameter('feedback', 70).ok).toBe(true);
    expect(kernel.setParameter('damping', 1_000).ok).toBe(true);
  });
});
