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
import { PARAMETRIC_EQUALISER } from './parametric-equaliser.js';
import {
  EVERY_LAYOUT,
  runWithChange,
  sineGain,
  lastAudibleFrame,
} from '../testing/filter-measures.js';

/** Band `band` on, with `rest` of its parameters by their names within the band. */
function bandOn(band: number, rest: Readonly<Record<string, ParameterValue>> = {}) {
  const values: Record<string, ParameterValue> = { [`band-${String(band)}-on`]: true };
  for (const [name, value] of Object.entries(rest)) values[`band-${String(band)}-${name}`] = value;
  return values;
}

processorProperties(PARAMETRIC_EQUALISER, {
  layouts: EVERY_LAYOUT,
  settings: [
    { ...bandOn(1), ...bandOn(3, { gain: 12, q: 4 }), ...bandOn(7, { gain: -9 }) },
    {
      ...bandOn(1, { type: 'notch', frequency: 60, q: 24 }),
      ...bandOn(2, { gain: 24 }),
      ...bandOn(4, { type: 'band-pass', q: 0.1 }),
      ...bandOn(5, { gain: -24, q: 0.1 }),
      ...bandOn(8, { q: 10 }),
    },
  ],
  bound: 64,
  // Bells at 0 dB are sections whose numerator and denominator are one, so
  // the input passes through them to the bit.
  passThrough: {
    values: { ...bandOn(3), ...bandOn(4), ...bandOn(5), ...bandOn(6) },
    tolerance: 0,
  },
});

describe('the parametric equaliser', () => {
  it('raises a sine at a bell by its gain and leaves a decade below alone', () => {
    const values = bandOn(5, { frequency: 1_000, gain: 6, q: 2 });
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, values, 1_000) - 6)).toBeLessThan(0.1);
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, values, 100))).toBeLessThan(0.1);
  });

  it('gives a shelf half its gain at its frequency and cuts below a low cut', () => {
    const high = bandOn(7, { frequency: 4_000, gain: 8 });
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, high, 4_000) - 4)).toBeLessThan(0.1);
    const low = bandOn(2, { frequency: 250, gain: -10 });
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, low, 250) + 5)).toBeLessThan(0.1);
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, low, 20) + 10)).toBeLessThan(0.1);
    const cut = bandOn(1, { frequency: 100 });
    expect(sineGain(PARAMETRIC_EQUALISER, cut, 100)).toBeCloseTo(-3.0103, 1);
    expect(sineGain(PARAMETRIC_EQUALISER, cut, 25)).toBeLessThan(-20);
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, cut, 1_000))).toBeLessThan(0.1);
  });

  it('adds the bands that are on, and hears nothing of a band that is off', () => {
    const both = {
      ...bandOn(3, { frequency: 200, gain: 6, q: 4 }),
      ...bandOn(6, { frequency: 3_000, gain: -6, q: 4 }),
    };
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, both, 200) - 6)).toBeLessThan(0.1);
    expect(Math.abs(sineGain(PARAMETRIC_EQUALISER, both, 3_000) + 6)).toBeLessThan(0.1);
    const input = [noise(2, { length: 8_000 }).channels[0] ?? new Float32Array(0)];
    const off = { 'band-2-gain': 24, 'band-5-gain': -24 };
    const [output] = runProcessor(
      PARAMETRIC_EQUALISER,
      { layout: StandardLayouts.mono, values: off },
      input,
    );
    expect(fingerprint(output ?? new Float32Array(0))).toBe(
      fingerprint(input[0] ?? new Float32Array(1)),
    );
  });

  it('moves a gain while it plays to the same bits however the stream is cut', () => {
    const input = [noise(4, { length: 12_000 }).channels[0] ?? new Float32Array(0)];
    const settings = { layout: StandardLayouts.mono, values: bandOn(4, { gain: -6 }) };
    const change = { frame: 5_003, name: 'band-4-gain', value: 12 };
    const [steady] = runWithChange(PARAMETRIC_EQUALISER, settings, input, [4_096], change);
    const [cut] = runWithChange(
      PARAMETRIC_EQUALISER,
      settings,
      input,
      [1, 7, 128, 333, 31],
      change,
    );
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
    const [unmoved] = runProcessor(PARAMETRIC_EQUALISER, settings, input);
    expect(unmoved?.slice(5_100)).not.toEqual(steady?.slice(5_100));
  });

  it('refuses to switch a band or change its type while running, or a gain past its range', () => {
    const { kernel } = processorKernel(PARAMETRIC_EQUALISER, {
      layout: StandardLayouts.mono,
      values: bandOn(2),
    });
    expect(expectFailureCode(kernel.setParameter('band-2-on', 0))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('band-2-type', 1))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('band-2-gain', 30))).toBe(
      'node.parameter-invalid',
    );
    expect(kernel.setParameter('band-8-frequency', 12_000).ok).toBe(true);
  });

  it('needs no lead-in when flat, and settles within the one it declares when not', () => {
    const settingsOf = (values: Readonly<Record<string, ParameterValue>>) => ({
      values: processorValues(PARAMETRIC_EQUALISER, values),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    });
    expect(PARAMETRIC_EQUALISER.descriptor.leadIn(settingsOf({}))).toBe(0);
    const values = {
      ...bandOn(2, { frequency: 40, gain: 12 }),
      ...bandOn(3, { frequency: 60, gain: 15, q: 8 }),
    };
    const impulse = new Float32Array(192_000);
    impulse[0] = 1;
    const [response = new Float32Array(0)] = runProcessor(
      PARAMETRIC_EQUALISER,
      { layout: StandardLayouts.mono, values },
      [impulse],
    );
    // The response less the impulse itself, which a bell or a shelf passes.
    const tail = response.map((sample, frame) => (frame === 0 ? sample - 1 : sample));
    const last = lastAudibleFrame(tail);
    expect(PARAMETRIC_EQUALISER.descriptor.leadIn(settingsOf(values))).toBeGreaterThanOrEqual(last);
  });
});
