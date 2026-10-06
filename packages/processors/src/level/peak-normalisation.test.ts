import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  createCancellationSource,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';
import { noisySine } from '@audiogubbins/test-fixtures';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_BLOCK_FRAMES,
  TEST_RATE,
  processorKernel,
  processorKernelOf,
  processorStep,
  runProcessor,
} from '../testing/processor-run.js';
import { firstDifference, measureOf, normalised, peaksOf } from '../testing/level-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { PEAK_NORMALISATION } from './peak-normalisation.js';

const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.surround5_1,
  setLayout(1, 'sn3d'),
];

// A measurement is made for one channel count, so each layout is given its own.
for (const layout of LAYOUTS) {
  processorProperties(PEAK_NORMALISATION, {
    layouts: [layout],
    settings: [{ target: -12, detection: 'true-peak' }, { target: 0 }],
    measured: [TEST_RATE, layout.roles.length, 0.5, 0.56],
    bound: 4,
    passThrough: { values: {}, tolerance: 0 },
  });
}

/** `frames` of a sine of `turns` a frame at `amplitude`, by the canonical sine. */
function tone(frames: number, turns: number, amplitude: number, phase = 0): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, frame) => amplitude * sineOfTurns(frame * turns + phase),
  );
}

const LENGTH = 24_000;

describe('peak normalisation', () => {
  it('meets the target with its loudest channel and keeps the balance between them', async () => {
    const left = tone(LENGTH, 0.01, 0.25);
    const right = tone(LENGTH, 0.013, 0.125);
    const { output } = await normalised(
      PEAK_NORMALISATION,
      { layout: StandardLayouts.stereo, values: { target: -6 } },
      [left, right],
    );
    const louder = peaksOf([output[0] ?? left]).samplePeak;
    expect(louder).toBeCloseTo(-6, 3);
    // The quieter channel is moved by the same gain, so it stays as far under.
    const under = peaksOf([right]).samplePeak - peaksOf([left]).samplePeak;
    expect(peaksOf([output[1] ?? right]).samplePeak - louder).toBeCloseTo(under, 4);
  });

  it('takes the true peak between samples where its detection asks for it', async () => {
    // A quarter-rate sine from 45°: every sample is 3 dB under the waveform's peak.
    const input = [tone(LENGTH, 0.25, 0.5, 0.125)];
    const settings = { layout: StandardLayouts.mono } as const;
    const bySample = await normalised(
      PEAK_NORMALISATION,
      { ...settings, values: { target: -1 } },
      input,
    );
    const byTrue = await normalised(
      PEAK_NORMALISATION,
      { ...settings, values: { target: -1, detection: 'true-peak' } },
      input,
    );
    expect(peaksOf(bySample.output).samplePeak).toBeCloseTo(-1, 3);
    expect(Math.abs(peaksOf(byTrue.output).truePeak + 1)).toBeLessThan(0.05);
    expect(peaksOf(byTrue.output).samplePeak).toBeLessThan(-3.5);
  });

  it('keeps a gain of 1 for silence, which has no peak to move', () => {
    const input = [noisySine(440).channels[0]?.slice(0, LENGTH) ?? new Float32Array(LENGTH)];
    const [output] = runProcessor(
      PEAK_NORMALISATION,
      { layout: StandardLayouts.mono, values: { target: -20 }, measured: [TEST_RATE, 1, 0, 0] },
      input,
    );
    expect(firstDifference([output ?? new Float32Array(0)], input)).toBeUndefined();
  });

  it('passes its input through for a measurement that is stale or of another shape', () => {
    const input = [noisySine(440).channels[0]?.slice(0, LENGTH) ?? new Float32Array(LENGTH)];
    for (const measured of [
      [44_100, 1, 0.5, 0.5],
      [TEST_RATE, 2, 0.5, 0.5],
      [TEST_RATE, 1, 0.5],
      [TEST_RATE, 1, 0.5, 0.5, 0.5],
    ]) {
      const [output] = runProcessor(
        PEAK_NORMALISATION,
        { layout: StandardLayouts.mono, values: { target: -20 }, measured },
        input,
      );
      expect(firstDifference([output ?? new Float32Array(0)], input)).toBeUndefined();
    }
    // And the same measurement, current, moves it.
    const [moved] = runProcessor(
      PEAK_NORMALISATION,
      { layout: StandardLayouts.mono, values: { target: -20 }, measured: [TEST_RATE, 1, 0.5, 0.5] },
      input,
    );
    expect(firstDifference([moved ?? new Float32Array(0)], input)).toBeDefined();
  });

  it('refuses samples for its measurement, the kind a model’s output is, with the reason', () => {
    // Samples holding the very numbers a current measurement holds: only
    // their kind is wrong.
    const made = processorKernelOf(PEAK_NORMALISATION, {
      layout: StandardLayouts.mono,
      measured: Float32Array.from([TEST_RATE, 1, 0.5, 0.5]),
    });
    expect(expectFailureCode(made)).toBe('processor.measurement-kind');
    expect(made.ok ? undefined : made.failures[0].summary).toContain('its node holds samples');
  });

  it('measures the same however its pass is cut, and hears NaN and infinity as silence', async () => {
    const settings = { layout: StandardLayouts.stereo } as const;
    const clean = [tone(LENGTH, 0.01, 0.3), tone(LENGTH, 0.02, 0.6)];
    const whole = await measureOf(PEAK_NORMALISATION, settings, clean, LENGTH);
    for (const chunk of [1, 7, 4_096]) {
      expect(await measureOf(PEAK_NORMALISATION, settings, clean, chunk)).toEqual(whole);
    }
    const spoiled = clean.map((channel) => channel.slice());
    const silenced = clean.map((channel) => channel.slice());
    for (const [channel, samples] of spoiled.entries()) {
      samples[100] = Number.NaN;
      samples[101] = Infinity;
      const quiet = silenced[channel];
      if (quiet !== undefined) quiet.fill(0, 100, 102);
    }
    expect(await measureOf(PEAK_NORMALISATION, settings, spoiled)).toEqual(
      await measureOf(PEAK_NORMALISATION, settings, silenced),
    );
  });

  it('ends its measurement with a cancellation, heard or answering', async () => {
    if (PEAK_NORMALISATION.measurer === undefined) throw new Error('It measures its input.');
    const layout = StandardLayouts.mono;
    const measurer = expectSuccess(
      PEAK_NORMALISATION.measurer(processorStep(PEAK_NORMALISATION, { layout }).settings, layout, {
        sampleRate: TEST_RATE,
        blockFrames: TEST_BLOCK_FRAMES,
        dsp: REFERENCE_DSP,
      }),
    );
    const source = createCancellationSource();
    const input = [tone(LENGTH, 0.01, 0.5)];
    await measurer.add(input, LENGTH, source.signal);
    source.cancel(new Error('The person stopped the render.'));
    await expect(measurer.add(input, LENGTH, source.signal)).rejects.toThrow(
      'The person stopped the render.',
    );
    await expect(measurer.result(source.signal)).rejects.toThrow('The person stopped the render.');
    measurer.release();
  });

  it('moves to a new target while it plays over a ramp, and refuses what cannot move', () => {
    const { kernel } = processorKernel(PEAK_NORMALISATION, {
      layout: StandardLayouts.mono,
      values: { target: -6 },
      measured: [TEST_RATE, 1, 1, 1],
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
    expect(kernel.setParameter('target', -12).ok).toBe(true);
    kernel.process([block([ones])], [block([out])], frames);
    expect(out[0]).toBeCloseTo(decibelsToGain(-6), 6);
    expect(out[10]).toBeLessThan(out[0] ?? 0);
    expect(out[frames - 1]).toBeCloseTo(decibelsToGain(-12), 6);
    expect(kernel.setParameter('target', 6).ok).toBe(false);
    expect(kernel.setParameter('detection', 1).ok).toBe(false);
  });
});
