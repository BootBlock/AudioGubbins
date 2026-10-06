import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  ambisonicLayout,
  AmbisonicNormalisation,
  AmbisonicOrdering,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';

import { processorProperties } from '../testing/processor-properties.js';
import {
  processorKernel,
  processorValues,
  runProcessor,
  TEST_RATE,
} from '../testing/processor-run.js';
import { MAXIMUM_QUALITY } from '@audiogubbins/domain';

import { AMBISONIC_ROTATION } from './ambisonic-rotate.js';
import { largestDifference } from '../testing/sample-difference.js';
import {
  AMBISONIC_LAYOUTS,
  NORMALISATIONS,
  ORDERS,
  burst,
  encoded,
  setLayout,
  turned,
} from '../testing/space-measures.js';

processorProperties(AMBISONIC_ROTATION, {
  layouts: AMBISONIC_LAYOUTS,
  settings: [
    { yaw: 90, pitch: -30, roll: 45 },
    { yaw: -180, pitch: 180, roll: -180 },
  ],
  bound: 4,
  passThrough: { values: { yaw: 0, pitch: 0, roll: 0 }, tolerance: 1e-6 },
});

/** The turns each direction is checked under: a yaw, a pitch, a roll, and all three. */
const TURNS = [
  [90, 0, 0],
  [0, 35, 0],
  [0, 0, -60],
  [-120, 25, 70],
] as const;

describe('the ambisonic rotation', () => {
  it('turns an encoded source to where the encoder would have put it, at every order and normalisation', () => {
    const source = burst();
    for (const [orderKey, order] of ORDERS) {
      for (const [normalisation] of NORMALISATIONS) {
        const layout = setLayout(order, normalisation);
        for (const [yaw, pitch, roll] of TURNS) {
          const at = { azimuth: 30, elevation: 20 };
          const field = encoded({ ...at, order: orderKey, normalisation }, source);
          const rotated = runProcessor(
            AMBISONIC_ROTATION,
            { layout, values: { yaw, pitch, roll } },
            field,
          );
          const moved = turned(at.azimuth, at.elevation, yaw, pitch, roll);
          const expected = encoded({ ...moved, order: orderKey, normalisation }, source);
          expect(largestDifference(rotated, expected)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('comes back to the field it was given after two half turns', () => {
    const layout = setLayout(3, 'sn3d');
    const field = encoded({ azimuth: -70, elevation: 40, order: 'third' }, burst());
    const half = { yaw: 180, pitch: 180, roll: 180 };
    const once = runProcessor(AMBISONIC_ROTATION, { layout, values: half }, field);
    const twice = runProcessor(AMBISONIC_ROTATION, { layout, values: half }, once);
    expect(largestDifference(twice, field)).toBeLessThan(1e-6);
  });

  it('refuses a layout that is not an ambisonic set of order 1 to 3, saying why', () => {
    const values = processorValues(AMBISONIC_ROTATION);
    const fourth = expectSuccess(
      ambisonicLayout({
        order: 4,
        ordering: AmbisonicOrdering.Acn,
        normalisation: AmbisonicNormalisation.Sn3d,
      }),
    );
    for (const layout of [StandardLayouts.stereo, StandardLayouts.surround5_1, fourth]) {
      const made = AMBISONIC_ROTATION.descriptor.outputLayout(layout, values);
      expect(expectFailureCode(made)).toBe('processor.layout-refused');
    }
    const first = setLayout(1, 'fuma');
    expect(expectSuccess(AMBISONIC_ROTATION.descriptor.outputLayout(first, values))).toBe(first);
  });

  it('moves its yaw while it plays to the same bits however the stream is cut', () => {
    const layout = setLayout(2, 'n3d');
    const field = encoded(
      { azimuth: 10, elevation: 0, order: 'second', normalisation: 'n3d' },
      burst(12_000),
    );
    const settings = { layout, values: { yaw: 0 } };
    const change = { frame: 3_001, name: 'yaw', value: 120 };
    const steady = runProcessor(AMBISONIC_ROTATION, settings, field, [4_096], change);
    const cut = runProcessor(AMBISONIC_ROTATION, settings, field, [1, 7, 128, 333, 31], change);
    expect(cut.map((channel) => fingerprint(channel))).toEqual(
      steady.map((channel) => fingerprint(channel)),
    );
    // Before the change the field is untouched; once the ramp has run it is
    // turned by the whole 120°.
    const unmoved = runProcessor(AMBISONIC_ROTATION, settings, field);
    expect(
      largestDifference(
        unmoved.map((c) => c.slice(0, 3_000)),
        steady.map((c) => c.slice(0, 3_000)),
      ),
    ).toBe(0);
    const turnedField = runProcessor(AMBISONIC_ROTATION, { layout, values: { yaw: 120 } }, field);
    const settled = 3_001 + 480 + 32;
    expect(
      largestDifference(
        turnedField.map((c) => c.slice(settled)),
        steady.map((c) => c.slice(settled)),
      ),
    ).toBeLessThan(1e-6);
  });

  it('refuses an angle outside its range, and declares neither latency nor lead-in', () => {
    const { kernel } = processorKernel(AMBISONIC_ROTATION, { layout: setLayout(1, 'sn3d') });
    expect(expectFailureCode(kernel.setParameter('yaw', 181))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('order', 1))).toBe('node.parameter-unknown');
    expect(kernel.setParameter('roll', -45).ok).toBe(true);
    const settings = {
      values: processorValues(AMBISONIC_ROTATION),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    expect(AMBISONIC_ROTATION.descriptor.latency(settings)).toEqual({ kind: 'known', frames: 0 });
    expect(AMBISONIC_ROTATION.descriptor.leadIn(settings)).toBe(0);
  });
});
