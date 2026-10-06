import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  sampleRate,
  type ChannelLayout,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { bursts, inRoom } from '../testing/spectral-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { DEREVERBERATION, MAXIMUM_TAPS, dereverbFrameSize } from './dereverb.js';

const FIRST_ORDER = setLayout(1, 'sn3d');

processorProperties(DEREVERBERATION, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo],
  settings: [
    { strength: 50, delay: 3, order: 12, adaptation: 0.5 },
    { delay: 8, order: 1, adaptation: 30 },
  ],
  passThrough: { values: { strength: 0 }, tolerance: 1e-6 },
});

// Every channel is predicted from every channel, at a cost that grows with the
// cube of their frames, so the wider layouts are run at lower orders beside
// the default.
processorProperties(DEREVERBERATION, {
  layouts: [StandardLayouts.surround5_1, FIRST_ORDER],
  settings: [
    { strength: 50, order: 2, adaptation: 0.5 },
    { delay: 8, order: 1, adaptation: 30 },
  ],
  passThrough: { values: { strength: 0, order: 1 }, tolerance: 1e-6 },
});

function settingsOf(
  values: Readonly<Record<string, number>>,
  rate: number = TEST_RATE,
): ProcessorSettings {
  return {
    values: processorValues(DEREVERBERATION, values),
    sampleRate: expectSuccess(sampleRate(rate)),
    quality: MAXIMUM_QUALITY.settings,
  };
}

describe('dereverberation', () => {
  it('frames by the largest power of two within 1/16 s, and declares N − 1 frames of latency', () => {
    for (const [rate, size] of [
      [8_000, 256],
      [16_000, 512],
      [44_100, 2_048],
      [48_000, 2_048],
      [96_000, 4_096],
      [192_000, 8_192],
    ] as const) {
      expect(dereverbFrameSize(rate)).toBe(size);
      expect(DEREVERBERATION.descriptor.latency(settingsOf({}, rate))).toEqual({
        kind: 'known',
        frames: size - 1,
      });
    }
  });

  it('refuses a layout and order whose filter would read more frames a bin than it can solve for', () => {
    const at = (layout: ChannelLayout = StandardLayouts.surround7_1, order = 6) =>
      DEREVERBERATION.descriptor.outputLayout(layout, processorValues(DEREVERBERATION, { order }));
    expect(expectSuccess(at())).toBe(StandardLayouts.surround7_1);
    expect(8 * 6).toBe(MAXIMUM_TAPS);
    const refused = at(StandardLayouts.surround7_1, 7);
    expect(expectFailureCode(refused)).toBe('processor.layout-refused');
    expect(refused.ok ? '' : refused.failures[0].summary).toContain('set the order to 6 or less');
    expect(expectFailureCode(at(StandardLayouts.surround7_1_4))).toBe('processor.layout-refused');
  });

  it('leaves a sound with no room as it was, within −40 dB, and takes from one in a room', () => {
    // Bursts over a steady floor 40 dB down, so no frame is silence the
    // filter could fit exactly.
    const dry = bursts(3 * TEST_RATE, 0.005);
    const [out] = runProcessor(DEREVERBERATION, { layout: StandardLayouts.mono }, [dry], [4_096]);
    let [difference, energy] = [0, 0];
    for (let frame: number = TEST_RATE; frame < dry.length - 2_047; frame += 1) {
      difference += ((out?.[frame + 2_047] ?? 0) - (dry[frame] ?? 0)) ** 2;
      energy += (dry[frame] ?? 0) ** 2;
    }
    expect(10 * Math.log10(difference / energy)).toBeLessThan(-40);
    const wet = inRoom(dry, 11, 0.6);
    const [dried] = runProcessor(DEREVERBERATION, { layout: StandardLayouts.mono }, [wet], [4_096]);
    let change = 0;
    for (let frame: number = TEST_RATE; frame < wet.length - 2_047; frame += 1) {
      change += ((dried?.[frame + 2_047] ?? 0) - (wet[frame] ?? 0)) ** 2;
    }
    expect(10 * Math.log10(change / energy)).toBeGreaterThan(-30);
  });

  it('settles within its lead-in when started part way through a stream on its frame grid', () => {
    const values = { adaptation: 0.5, order: 4 };
    const leadIn = DEREVERBERATION.descriptor.leadIn(settingsOf(values));
    const input = [0, 1].map((seed) => inRoom(bursts(leadIn + TEST_RATE), 11 + seed, 0.6));
    const whole = runProcessor(
      DEREVERBERATION,
      { layout: StandardLayouts.stereo, values },
      input,
      [4_096],
    );
    /** The worst channel's difference from the whole run, to its energy, in decibels. */
    const settled = (start: number) => {
      const late = runProcessor(
        DEREVERBERATION,
        { layout: StandardLayouts.stereo, values },
        input.map((channel) => channel.slice(start)),
        [4_096],
      );
      return Math.max(
        ...late.map((samples, channel) => {
          let [difference, energy] = [0, 0];
          for (let frame = leadIn; frame < samples.length; frame += 1) {
            const reference = whole[channel]?.[start + frame] ?? 0;
            difference += ((samples[frame] ?? 0) - reference) ** 2;
            energy += reference * reference;
          }
          return 10 * Math.log10(difference / energy);
        }),
      );
    };
    // A start off the transform's grid of hops hears the frames of another
    // grid, which no lead-in brings back to these.
    const grid = DEREVERBERATION.descriptor.frameGrid(settingsOf(values));
    const start = grid * Math.ceil(24_000 / grid);
    expect(settled(start)).toBeLessThan(-35);
    expect(settled(start + 100)).toBeGreaterThan(-30);
  });

  it('moves its strength while it plays, to the same bits however the stream is cut', () => {
    const input = [inRoom(bursts(TEST_RATE / 2), 11, 0.6)];
    const settings = { layout: StandardLayouts.mono, values: { strength: 20 } };
    const change = { frame: 9_001, name: 'strength', value: 90 };
    const [steady] = runProcessor(DEREVERBERATION, settings, input, [4_096], change);
    const [cut] = runProcessor(DEREVERBERATION, settings, input, [1, 7, 128, 333, 31], change);
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
    const [unmoved] = runProcessor(DEREVERBERATION, settings, input);
    expect(unmoved?.slice(0, 9_001)).toEqual(steady?.slice(0, 9_001));
    expect(unmoved?.slice(12_000)).not.toEqual(steady?.slice(12_000));
  });

  it('refuses a change of delay or order while it runs, or a strength outside its range', () => {
    const { kernel } = processorKernel(DEREVERBERATION, { layout: StandardLayouts.stereo });
    expect(expectFailureCode(kernel.setParameter('delay', 3))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('order', 3))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('strength', 101))).toBe('node.parameter-invalid');
    expect(kernel.setParameter('strength', 40).ok).toBe(true);
    expect(kernel.setParameter('adaptation', 10).ok).toBe(true);
  });
});
