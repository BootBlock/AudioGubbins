import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts, discreteLayout } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';

import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { AMBISONIC_ENCODER } from './ambisonic-encode.js';
import { largestDifference } from '../testing/sample-difference.js';
import { NORMALISATIONS, ORDERS, burst, encoded, setLayout } from '../testing/space-measures.js';

describe('the ambisonic encoder', () => {
  it('makes the set of the order and normalisation chosen, of a mono input only', () => {
    for (const [orderKey, order] of ORDERS) {
      for (const [normalisation] of NORMALISATIONS) {
        const values = processorValues(AMBISONIC_ENCODER, { order: orderKey, normalisation });
        const made = expectSuccess(
          AMBISONIC_ENCODER.descriptor.outputLayout(StandardLayouts.mono, values),
        );
        expect(made).toEqual(setLayout(order, normalisation));
      }
    }
    const values = processorValues(AMBISONIC_ENCODER);
    for (const layout of [
      StandardLayouts.stereo,
      StandardLayouts.surround5_1,
      setLayout(1, 'sn3d'),
      expectSuccess(discreteLayout(2)),
    ]) {
      const refused = AMBISONIC_ENCODER.descriptor.outputLayout(layout, values);
      expect(expectFailureCode(refused)).toBe('processor.layout-refused');
    }
  });

  it('weights each normalisation as the engine converts it: N3D by √(2l + 1), FuMa W by 1/√2', () => {
    const source = burst();
    const at = { azimuth: 40, elevation: 25, order: 'third' } as const;
    const sn3d = encoded({ ...at, normalisation: 'sn3d' }, source);
    const n3d = encoded({ ...at, normalisation: 'n3d' }, source);
    const fuma = encoded({ ...at, normalisation: 'fuma' }, source);
    const frame = 300;
    for (let acn = 0; acn < 16; acn += 1) {
      const degree = Math.floor(Math.sqrt(acn));
      expect(n3d[acn]?.[frame]).toBeCloseTo(
        Math.sqrt(2 * degree + 1) * (sn3d[acn]?.[frame] ?? 0),
        6,
      );
    }
    // FuMa's channel 0 is W at −3 dB, and its channel 1 is X, ACN 3, unscaled.
    expect(fuma[0]?.[frame]).toBeCloseTo(Math.SQRT1_2 * (sn3d[0]?.[frame] ?? 0), 6);
    expect(fuma[1]?.[frame]).toBeCloseTo(sn3d[3]?.[frame] ?? 0, 6);
  });

  it('moves its source while it plays to the same bits however the stream is cut', () => {
    const input = [burst(12_000)];
    const settings = { layout: StandardLayouts.mono, values: { order: 'second', azimuth: -45 } };
    const change = { frame: 3_001, name: 'azimuth', value: 100 };
    const steady = runProcessor(AMBISONIC_ENCODER, settings, input, [4_096], change);
    const cut = runProcessor(AMBISONIC_ENCODER, settings, input, [1, 7, 128, 333, 31], change);
    expect(cut.map((channel) => fingerprint(channel))).toEqual(
      steady.map((channel) => fingerprint(channel)),
    );
    // Once the ramp has run and a design has taken its end, the field is
    // the encoder's at the new azimuth.
    const moved = runProcessor(
      AMBISONIC_ENCODER,
      { ...settings, values: { order: 'second', azimuth: 100 } },
      input,
    );
    const settled = 3_001 + 480 + 32;
    expect(
      largestDifference(
        moved.map((channel) => channel.slice(settled)),
        steady.map((channel) => channel.slice(settled)),
      ),
    ).toBe(0);
    expect(largestDifference(moved, steady)).toBeGreaterThan(0.01);
  });

  it('refuses a direction outside its range or a change of order while it runs', () => {
    const { kernel } = processorKernel(AMBISONIC_ENCODER, { layout: StandardLayouts.mono });
    expect(expectFailureCode(kernel.setParameter('azimuth', 200))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('elevation', -91))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('order', 2))).toBe('node.parameter-unknown');
    expect(kernel.setParameter('elevation', 60).ok).toBe(true);
    const settings = {
      values: processorValues(AMBISONIC_ENCODER),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    expect(AMBISONIC_ENCODER.descriptor.latency(settings)).toEqual({ kind: 'known', frames: 0 });
    expect(AMBISONIC_ENCODER.descriptor.leadIn(settings)).toBe(0);
  });
});
