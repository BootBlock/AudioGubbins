import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import { decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_BLOCK_FRAMES,
  TEST_RATE,
  processorKernel,
  processorKernelOf,
  runProcessor,
} from '../testing/processor-run.js';
import {
  firstDifference,
  integratedOf,
  measureOf,
  normalised,
  peaksOf,
} from '../testing/level-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { LOUDNESS_NORMALISATION } from './loudness-normalisation.js';

const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.surround5_1,
  setLayout(1, 'sn3d'),
];

// A measurement is made for one channel count, so each layout is given its own.
for (const layout of LAYOUTS) {
  processorProperties(LOUDNESS_NORMALISATION, {
    layouts: [layout],
    settings: [{ target: -14 }, { 'limit-true-peak': true, ceiling: -3 }],
    measured: [TEST_RATE, layout.roles.length, 1, -30, 0.5],
    bound: 8,
    passThrough: { values: {}, tolerance: 0 },
  });
}

/** `seconds` of a 1 kHz sine at `level` dBFS, by the canonical sine, on each of `channels`. */
function tone(seconds: number, level: number, channels: number): Float32Array[] {
  const one = Float32Array.from(
    { length: seconds * TEST_RATE },
    (_, frame) => decibelsToGain(level) * sineOfTurns((frame % 48) / 48),
  );
  return Array.from({ length: channels }, () => one.slice());
}

const STEREO = StandardLayouts.stereo;

describe('loudness normalisation', () => {
  it('meets the target loudness, by the canonical meter, weighting channels by role', async () => {
    // Left, right and centre at −26 dBFS and the surrounds at −30, weighted 1.41.
    const levels = [-26, -26, -26, -200, -30, -30];
    const input = levels.map((level) => tone(5, level, 1)[0] ?? new Float32Array(0));
    const layout = StandardLayouts.surround5_1;
    const { output } = await normalised(
      LOUDNESS_NORMALISATION,
      { layout, values: { target: -16 } },
      input,
    );
    expect(Math.abs(integratedOf(layout, output) + 16)).toBeLessThan(0.1);
  });

  it('keeps a gain of 1 for a signal below the absolute gate', async () => {
    const input = tone(3, -80, 2);
    const { output, measured } = await normalised(
      LOUDNESS_NORMALISATION,
      { layout: STEREO },
      input,
    );
    expect(measured.slice(2, 4)).toEqual([0, 0]);
    expect(firstDifference(output, input)).toBeUndefined();
  });

  it('limits the gain so the true peak stays under the ceiling, and is then quieter', async () => {
    const input = tone(5, -20, 2);
    const values = { target: 0, 'limit-true-peak': true, ceiling: -2 };
    const limited = await normalised(LOUDNESS_NORMALISATION, { layout: STEREO, values }, input);
    const peak = peaksOf(limited.output).truePeak;
    expect(peak).toBeLessThanOrEqual(-2 + 0.05);
    expect(peak).toBeGreaterThan(-2 - 0.05);
    expect(integratedOf(STEREO, limited.output)).toBeLessThan(-1.5);
    // Without the ceiling the same target is met, and the peak goes past it.
    const free = await normalised(
      LOUDNESS_NORMALISATION,
      { layout: STEREO, values: { target: 0 } },
      input,
    );
    expect(Math.abs(integratedOf(STEREO, free.output))).toBeLessThan(0.1);
    expect(peaksOf(free.output).truePeak).toBeGreaterThan(-0.5);
  });

  it('holds the ceiling below the gate too, where the gain would be 1', async () => {
    // A full-scale click in a stream shorter than one 400 ms block of the
    // gate, so no block is measured at all.
    const input = [new Float32Array(TEST_RATE / 5)];
    (input[0] ?? new Float32Array(1))[4_000] = 1;
    const values = { 'limit-true-peak': true, ceiling: -6 };
    const { output, measured } = await normalised(
      LOUDNESS_NORMALISATION,
      { layout: StandardLayouts.mono, values },
      input,
    );
    expect(measured[2]).toBe(0);
    expect(peaksOf(output).truePeak).toBeLessThanOrEqual(-6 + 0.05);
  });

  it('passes its input through for a measurement that is stale or of another shape', () => {
    const input = tone(1, -30, 2);
    for (const measured of [
      [44_100, 2, 1, -30, 0.1],
      [TEST_RATE, 1, 1, -30, 0.1],
      [TEST_RATE, 2, 1, -30],
    ]) {
      const output = runProcessor(LOUDNESS_NORMALISATION, { layout: STEREO, measured }, input);
      expect(firstDifference(output, input)).toBeUndefined();
    }
    const moved = runProcessor(
      LOUDNESS_NORMALISATION,
      { layout: STEREO, measured: [TEST_RATE, 2, 1, -30, 0.1] },
      input,
    );
    expect(firstDifference(moved, input)).toBeDefined();
  });

  it('refuses samples for its measurement, the kind a model’s output is, with the reason', () => {
    // Samples holding the very numbers a current measurement holds: only
    // their kind is wrong.
    const made = processorKernelOf(LOUDNESS_NORMALISATION, {
      layout: STEREO,
      measured: Float32Array.from([TEST_RATE, 2, 1, -30, 0.5]),
    });
    expect(expectFailureCode(made)).toBe('processor.measurement-kind');
    expect(made.ok ? undefined : made.failures[0].summary).toContain('its node holds samples');
  });

  it('measures the same however its pass is cut', async () => {
    const input = tone(2, -18, 2);
    const whole = await measureOf(
      LOUDNESS_NORMALISATION,
      { layout: STEREO },
      input,
      input[0]?.length,
    );
    for (const chunk of [7, 4_096]) {
      expect(await measureOf(LOUDNESS_NORMALISATION, { layout: STEREO }, input, chunk)).toEqual(
        whole,
      );
    }
  });

  it('moves its target and its ceiling while it plays, and refuses the toggle', () => {
    const { kernel } = processorKernel(LOUDNESS_NORMALISATION, {
      layout: StandardLayouts.mono,
      values: { target: -20, 'limit-true-peak': true, ceiling: 0 },
      measured: [TEST_RATE, 1, 1, -20, 0.5],
    });
    const frames = TEST_BLOCK_FRAMES;
    const ones = new Float32Array(frames).fill(1);
    const out = new Float32Array(frames);
    const block = (channels: Float32Array[]) => ({
      layout: StandardLayouts.mono,
      sampleRate: TEST_RATE,
      frames,
      channels,
    });
    const run = () => {
      kernel.process([block([ones])], [block([out])], frames);
    };
    expect(kernel.setParameter('target', -26).ok).toBe(true);
    run();
    expect(out[frames - 1]).toBeCloseTo(decibelsToGain(-6), 6);
    // Up 20 dB would put the true peak of 0.5 past a ceiling of −6 dBTP.
    expect(kernel.setParameter('target', 0).ok).toBe(true);
    expect(kernel.setParameter('ceiling', -6).ok).toBe(true);
    run();
    expect(out[frames - 1]).toBeCloseTo(decibelsToGain(-6) / 0.5, 6);
    expect(kernel.setParameter('limit-true-peak', 0).ok).toBe(false);
    expect(kernel.setParameter('ceiling', 3).ok).toBe(false);
  });
});
