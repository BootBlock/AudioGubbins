import { describe, expect, it } from 'vitest';

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  MAXIMUM_QUALITY,
  StandardLayouts,
  ambisonicLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { AMBISONIC_DECODER, maxReWeights } from './ambisonic-decode.js';
import { NORMALISATIONS, ORDERS, encoded, setLayout } from '../testing/space-measures.js';

/** Each speaker option, its layout, and the azimuth of each role that has one. */
const SPEAKERS = [
  ['stereo', StandardLayouts.stereo, { left: 30, right: -30 }],
  [
    'quadraphonic',
    StandardLayouts.quadraphonic,
    { left: 45, right: -45, 'rear-left': 135, 'rear-right': -135 },
  ],
  [
    'surround-5-1',
    StandardLayouts.surround5_1,
    { left: 30, right: -30, centre: 0, 'surround-left': 110, 'surround-right': -110 },
  ],
  [
    'surround-7-1',
    StandardLayouts.surround7_1,
    {
      left: 30,
      right: -30,
      centre: 0,
      'surround-left': 90,
      'surround-right': -90,
      'rear-left': 135,
      'rear-right': -135,
    },
  ],
] as const;

/** The root mean square of each channel. */
function levels(channels: readonly Float32Array[]): number[] {
  return channels.map((samples) => {
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / samples.length);
  });
}

const TONE = Float32Array.from({ length: 4_800 }, (_, frame) => 0.25 * Math.sin(frame * 0.13));

describe('the ambisonic decoder', () => {
  it('plays a source encoded at a speaker loudest from that speaker, and nothing from the low-frequency channel', () => {
    for (const [speakers, layout, azimuths] of SPEAKERS) {
      for (const [orderKey, order] of ORDERS) {
        for (const [normalisation] of NORMALISATIONS) {
          for (const [role, azimuth] of Object.entries(azimuths)) {
            const field = encoded({ azimuth, elevation: 0, order: orderKey, normalisation }, TONE);
            const played = levels(
              runProcessor(
                AMBISONIC_DECODER,
                { layout: setLayout(order, normalisation), values: { speakers } },
                field,
              ),
            );
            const at = layout.roles.findIndex((one) => one === role);
            const loudest = played.indexOf(Math.max(...played));
            expect(loudest).toBe(at);
            const lfe = layout.roles.findIndex((one) => one === ChannelRole.LowFrequency);
            if (lfe !== -1) expect(played[lfe]).toBe(0);
          }
        }
      }
    }
  });

  it('weights each degree by max-rE, matching the approximation of Zotter and Frank', () => {
    // Their equation (10): r_E ≈ cos(137.9° / (N + 1.51)), within 1 %.
    for (const order of [1, 2, 3]) {
      const weights = maxReWeights(order);
      const radius = Math.cos(((137.9 / (order + 1.51)) * Math.PI) / 180);
      expect(weights[0]).toBe(1);
      expect(Math.abs((weights[1] ?? 0) - radius)).toBeLessThan(0.01);
    }
    // The second order's P₂(√(3/5)) is exactly (3 · 3/5 − 1) / 2 = 0.4.
    expect(maxReWeights(2)[2]).toBeCloseTo(0.4, 12);
  });

  it('makes the speaker layout chosen, of an ambisonic set of order 1 to 3 only', () => {
    for (const [speakers, layout] of SPEAKERS) {
      const values = processorValues(AMBISONIC_DECODER, { speakers });
      const made = AMBISONIC_DECODER.descriptor.outputLayout(setLayout(2, 'fuma'), values);
      expect(expectSuccess(made)).toEqual(layout);
    }
    const values = processorValues(AMBISONIC_DECODER);
    const fourth = expectSuccess(
      ambisonicLayout({
        order: 4,
        ordering: AmbisonicOrdering.Acn,
        normalisation: AmbisonicNormalisation.N3d,
      }),
    );
    for (const layout of [StandardLayouts.mono, StandardLayouts.stereo, fourth]) {
      const refused = AMBISONIC_DECODER.descriptor.outputLayout(layout, values);
      expect(expectFailureCode(refused)).toBe('processor.layout-refused');
    }
  });

  it('changes nothing while it runs, and declares neither latency nor lead-in', () => {
    const { kernel } = processorKernel(AMBISONIC_DECODER, { layout: setLayout(1, 'sn3d') });
    expect(expectFailureCode(kernel.setParameter('speakers', 1))).toBe('node.parameter-unknown');
    const settings = {
      values: processorValues(AMBISONIC_DECODER),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    expect(AMBISONIC_DECODER.descriptor.latency(settings)).toEqual({ kind: 'known', frames: 0 });
    expect(AMBISONIC_DECODER.descriptor.leadIn(settings)).toBe(0);
  });
});
