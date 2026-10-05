import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts, type ParameterValue } from '@audiogubbins/domain';
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
import { DE_HUM } from './de-hum.js';
import {
  EVERY_LAYOUT,
  lastAudibleFrame,
  runWithChange,
  sineGain,
} from '../testing/filter-measures.js';

processorProperties(DE_HUM, {
  layouts: EVERY_LAYOUT,
  settings: [
    { fundamental: '60-hz', harmonics: 12, q: 100 },
    { depth: 20, q: 5, offset: 1.5, harmonics: 1 },
  ],
  bound: 4,
  // At no depth every notch is a peaking section of 0 dB, whose numerator
  // and denominator are one, so the input passes to the bit.
  passThrough: { values: { depth: 0 }, tolerance: 0 },
});

/** The gain at `frequency` of de-hum at `values`, measured once its notches have settled. */
function gain(values: Readonly<Record<string, ParameterValue>>, frequency: number): number {
  return sineGain(DE_HUM, values, frequency, 4);
}

describe('de-hum', () => {
  it('takes out the fundamental and each harmonic asked for, and nothing between', () => {
    for (const harmonic of [50, 100, 150, 200]) expect(gain({}, harmonic)).toBeLessThan(-60);
    expect(Math.abs(gain({}, 250))).toBeLessThan(0.1);
    expect(Math.abs(gain({}, 1_000))).toBeLessThan(0.01);
    const sixty = { fundamental: '60-hz', harmonics: 12 };
    expect(gain(sixty, 720)).toBeLessThan(-60);
    expect(Math.abs(gain(sixty, 1_000))).toBeLessThan(0.1);
  });

  it('cuts by the depth asked for below a full notch', () => {
    // A lone notch: a neighbour's skirt adds to the cut at another's centre.
    for (const depth of [6, 20, 45]) {
      expect(Math.abs(gain({ depth, q: 10, harmonics: 1 }, 50) + depth)).toBeLessThan(0.1);
    }
  });

  it('moves every notch by the fine offset', () => {
    // 48 Hz is 2 Hz below the 50 Hz fundamental, outside a notch of Q 30.
    expect(gain({ harmonics: 1 }, 48)).toBeGreaterThan(-3);
    expect(gain({ harmonics: 1, offset: -2 }, 48)).toBeLessThan(-60);
    expect(gain({ harmonics: 2, offset: -2 }, 96)).toBeLessThan(-60);
  });

  it('moves its depth while it plays to the same bits however the stream is cut', () => {
    const input = [noise(8, { length: 12_000 }).channels[0] ?? new Float32Array(0)];
    const settings = { layout: StandardLayouts.mono, values: { depth: 10, q: 5 } };
    const change = { frame: 4_001, name: 'depth', value: 60 };
    const [steady] = runWithChange(DE_HUM, settings, input, [4_096], change);
    const [cut] = runWithChange(DE_HUM, settings, input, [1, 7, 128, 333, 31], change);
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
  });

  it('refuses to change its fundamental or its harmonics while running', () => {
    const { kernel } = processorKernel(DE_HUM, { layout: StandardLayouts.stereo });
    expect(expectFailureCode(kernel.setParameter('fundamental', 60))).toBe(
      'node.parameter-unknown',
    );
    expect(expectFailureCode(kernel.setParameter('harmonics', 3))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('q', 200))).toBe('node.parameter-invalid');
    expect(kernel.setParameter('offset', -1.5).ok).toBe(true);
  });

  it('settles within the lead-in it declares', () => {
    const values = { q: 50, harmonics: 3 };
    const settings = {
      values: processorValues(DE_HUM, values),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    const impulse = new Float32Array(TEST_RATE * 8);
    impulse[0] = 1;
    const [response = new Float32Array(0)] = runProcessor(
      DE_HUM,
      { layout: StandardLayouts.mono, values },
      [impulse],
    );
    response[0] = (response[0] ?? 0) - 1;
    expect(DE_HUM.descriptor.leadIn(settings)).toBeGreaterThanOrEqual(lastAudibleFrame(response));
  });
});
