import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { FILTER } from './filter.js';
import { EVERY_LAYOUT, lastAudibleFrame, sineGain } from '../testing/filter-measures.js';

processorProperties(FILTER, {
  layouts: EVERY_LAYOUT,
  settings: [
    { mode: 'high-pass', slope: '48-db', cutoff: 200, resonance: 2 },
    { mode: 'band-pass', slope: '24-db', cutoff: 3_000, resonance: 4 },
    { mode: 'notch', slope: '36-db', cutoff: 50, resonance: 10 },
    { mode: 'all-pass', slope: '12-db', cutoff: 20_000, resonance: 0.1 },
  ],
});

/**
 * The gain of a bilinear Butterworth low-pass of `order` at `frequency`, for
 * a cutoff of `cutoff`: `1 / √(1 + (tan(πf/fs) / tan(πfc/fs))^2n)`, the
 * analogue filter's response at the prewarped frequency.
 */
function butterworthDecibels(order: number, cutoff: number, frequency: number): number {
  const ratio =
    Math.tan((Math.PI * frequency) / TEST_RATE) / Math.tan((Math.PI * cutoff) / TEST_RATE);
  return -10 * Math.log10(1 + ratio ** (2 * order));
}

const SLOPES = [
  ['12-db', 2],
  ['24-db', 4],
  ['36-db', 6],
  ['48-db', 8],
] as const;

describe('the filter', () => {
  it('is a Butterworth low-pass of the order its slope names, 3 dB down at the cutoff', () => {
    for (const [slope, order] of SLOPES) {
      const values = { mode: 'low-pass', slope, cutoff: 1_000 };
      expect(sineGain(FILTER, values, 1_000)).toBeCloseTo(-3.0103, 1);
      expect(Math.abs(sineGain(FILTER, values, 250))).toBeLessThan(0.1);
      expect(
        Math.abs(sineGain(FILTER, values, 4_000) - butterworthDecibels(order, 1_000, 4_000)),
      ).toBeLessThan(0.5);
    }
  });

  it('is a high-pass that keeps the band above its cutoff', () => {
    const values = { mode: 'high-pass', slope: '24-db', cutoff: 1_000 };
    expect(sineGain(FILTER, values, 1_000)).toBeCloseTo(-3.0103, 1);
    expect(Math.abs(sineGain(FILTER, values, 8_000))).toBeLessThan(0.1);
    expect(sineGain(FILTER, values, 250)).toBeLessThan(-45);
  });

  it('raises the cutoff to the resonance as a gain, whatever the slope', () => {
    // The sections' Qs multiply to 1/√2 for a Butterworth cascade, so scaling
    // the last by the resonance over 1/√2 makes the gain at the cutoff the
    // resonance itself.
    for (const [slope] of SLOPES) {
      const values = { mode: 'low-pass', slope, cutoff: 2_000, resonance: 4 };
      expect(sineGain(FILTER, values, 2_000)).toBeCloseTo(20 * Math.log10(4), 1);
    }
  });

  it('passes its centre as a band-pass, takes it away as a notch, and passes all as an all-pass', () => {
    expect(Math.abs(sineGain(FILTER, { mode: 'band-pass', cutoff: 3_000 }, 3_000))).toBeLessThan(
      0.1,
    );
    const gentle = sineGain(FILTER, { mode: 'band-pass', cutoff: 3_000, slope: '12-db' }, 750);
    const steep = sineGain(FILTER, { mode: 'band-pass', cutoff: 3_000, slope: '48-db' }, 750);
    // Four like sections at 48 dB per octave, one at 12: four times its decibels.
    expect(steep).toBeCloseTo(4 * gentle, 1);
    expect(sineGain(FILTER, { mode: 'notch', cutoff: 1_000, resonance: 2 }, 1_000)).toBeLessThan(
      -60,
    );
    for (const frequency of [100, 1_000, 8_000]) {
      expect(
        Math.abs(sineGain(FILTER, { mode: 'all-pass', cutoff: 1_000 }, frequency)),
      ).toBeLessThan(0.01);
    }
  });

  it('moves its cutoff while it plays to the same bits however the stream is cut', () => {
    const input = [noise(5, { length: 12_000 }).channels[0] ?? new Float32Array(0)];
    const settings = { layout: StandardLayouts.mono, values: { cutoff: 500 } };
    const change = { frame: 3_001, name: 'cutoff', value: 5_000 };
    const [steady] = runProcessor(FILTER, settings, input, [4_096], change);
    const [cut] = runProcessor(FILTER, settings, input, [1, 7, 128, 333, 31], change);
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
    const [unmoved] = runProcessor(FILTER, settings, input);
    expect(unmoved?.[2_000]).toBe(steady?.[2_000]);
    expect(unmoved?.slice(3_100)).not.toEqual(steady?.slice(3_100));
  });

  it('refuses to change its mode or slope while running, or a cutoff outside its range', () => {
    const { kernel } = processorKernel(FILTER, { layout: StandardLayouts.stereo });
    expect(expectFailureCode(kernel.setParameter('mode', 1))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('slope', 1))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('cutoff', 30_000))).toBe('node.parameter-invalid');
    expect(kernel.setParameter('resonance', 3).ok).toBe(true);
  });

  it('settles within the lead-in it declares, and declares no latency', () => {
    const values = { mode: 'low-pass', slope: '48-db', cutoff: 100, resonance: 6 };
    const settings = {
      values: processorValues(FILTER, values),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    const impulse = new Float32Array(96_000);
    impulse[0] = 1;
    const [response = new Float32Array(0)] = runProcessor(
      FILTER,
      { layout: StandardLayouts.mono, values },
      [impulse],
    );
    const last = lastAudibleFrame(response);
    expect(FILTER.descriptor.leadIn(settings)).toBeGreaterThanOrEqual(last);
    expect(FILTER.descriptor.latency(settings)).toEqual({ kind: 'known', frames: 0 });
  });
});
