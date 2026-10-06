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
import { lastAudibleFrame } from '../testing/filter-measures.js';
import { REVERB } from './reverb.js';
import { lineLengths } from './reverb-network.js';
import { correlation, measuredRt60, reverbImpulse } from '../testing/reverb-measures.js';
import { setLayout } from '../testing/space-measures.js';

processorProperties(REVERB, {
  layouts: [
    StandardLayouts.mono,
    StandardLayouts.stereo,
    StandardLayouts.surround5_1,
    setLayout(1, 'sn3d'),
  ],
  settings: [
    { size: 1, decay: 30, damping: 0, 'pre-delay': 200 },
    { size: 0.1, decay: 0.1, damping: 90, 'pre-delay': 0, width: 0 },
  ],
});

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** `channels` channels each carrying the same noise, so all the decorrelation is the reverb's. */
function sameNoise(channels: number): Float32Array[] {
  const source = noise(21, { length: 24_000 }).channels[0] ?? new Float32Array(0);
  return Array.from({ length: channels }, () => source.slice());
}

describe('the reverb', () => {
  it('falls 60 dB in the decay time it is set to, within 10 %', () => {
    // Each decay many times the longest line, so the measure has a tail of
    // many passes through the lines to read.
    for (const [decay, size] of [
      [0.6, 0.3],
      [2.5, 1],
    ] as const) {
      const response = reverbImpulse(
        { decay, damping: 0, 'pre-delay': 0, size },
        Math.ceil(2 * decay * TEST_RATE),
      );
      expect(Math.abs(measuredRt60(response, TEST_RATE) / decay - 1)).toBeLessThan(0.1);
    }
  });

  it('shortens the decay at high frequencies by its damping', () => {
    const tail = (damping: number) => reverbImpulse({ decay: 1, damping, 'pre-delay': 0 }, 48_000);
    // The energy of the first difference, a high-pass, against the energy,
    // over the tail's second half: the brightness left once it has rung.
    const brightness = (response: Float32Array) => {
      let [high, all] = [0, 0];
      for (let frame = 24_000; frame < response.length; frame += 1) {
        high += ((response[frame] ?? 0) - (response[frame - 1] ?? 0)) ** 2;
        all += (response[frame] ?? 0) ** 2;
      }
      return high / all;
    };
    expect(brightness(tail(80))).toBeLessThan(0.1 * brightness(tail(0)));
  });

  it('gives every channel of a layout its own decorrelated tail, and one shared tail at no width', () => {
    for (const layout of [
      StandardLayouts.stereo,
      StandardLayouts.surround7_1,
      StandardLayouts.surround7_1_4,
    ]) {
      const width = layout.roles.length;
      const wide = runProcessor(REVERB, { layout, values: { 'pre-delay': 0 } }, sameNoise(width));
      for (let channel = 1; channel < width; channel += 1) {
        for (let other = 0; other < channel; other += 1) {
          const rho = correlation(
            wide[channel] ?? new Float32Array(0),
            wide[other] ?? new Float32Array(0),
          );
          expect(Math.abs(rho)).toBeLessThan(0.3);
        }
      }
    }
    const narrow = runProcessor(
      REVERB,
      { layout: StandardLayouts.stereo, values: { width: 0 } },
      sameNoise(2),
    );
    expect(narrow[0]).toEqual(narrow[1]);
  });

  it('starts its tail after the pre-delay and the shortest line, to the frame', () => {
    const preDelay = 12.5;
    const size = 0.5;
    const response = reverbImpulse({ 'pre-delay': preDelay, size }, 4_000);
    const first = response.findIndex((sample) => sample !== 0);
    const shortest = Math.min(...lineLengths(size, TEST_RATE));
    expect(first).toBe((preDelay * TEST_RATE) / 1_000 + shortest);
  });

  it('scales its lines to distinct primes, mutually prime at every size and rate', () => {
    for (const rate of [8_000, 44_100, 48_000, 192_000]) {
      for (const size of [0.1, 0.37, 1]) {
        const lengths = lineLengths(size, rate);
        for (const [index, length] of lengths.entries()) {
          for (const other of lengths.slice(0, index)) {
            expect(greatestCommonDivisor(length, other)).toBe(1);
          }
        }
      }
    }
  });

  it('falls silent within the lead-in it declares, and declares no latency', () => {
    for (const values of [
      { decay: 0.3, damping: 0, 'pre-delay': 50, size: 1 },
      { decay: 0.6, damping: 70, 'pre-delay': 0, size: 0.2 },
    ]) {
      const settings = {
        values: processorValues(REVERB, values),
        sampleRate: TEST_RATE,
        quality: MAXIMUM_QUALITY.settings,
      };
      const leadIn = REVERB.descriptor.leadIn(settings);
      const response = reverbImpulse(values, leadIn + 24_000);
      expect(lastAudibleFrame(response)).toBeLessThanOrEqual(leadIn);
      expect(REVERB.descriptor.latency(settings)).toEqual({ kind: 'known', frames: 0 });
    }
  });

  it('moves its decay while it plays to the same bits however the stream is cut', () => {
    const input = [noise(4, { length: 12_000 }).channels[0] ?? new Float32Array(0)];
    const settings = { layout: StandardLayouts.mono, values: { decay: 0.5 } };
    const change = { frame: 3_001, name: 'decay', value: 4 };
    const [steady] = runProcessor(REVERB, settings, input, [4_096], change);
    const [cut] = runProcessor(REVERB, settings, input, [1, 7, 128, 333, 31], change);
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
    const [unmoved] = runProcessor(REVERB, settings, input);
    expect(unmoved?.slice(0, 3_001)).toEqual(steady?.slice(0, 3_001));
    expect(unmoved?.slice(3_100)).not.toEqual(steady?.slice(3_100));
  });

  it('refuses a change of size while it runs, or a decay outside its range', () => {
    const { kernel } = processorKernel(REVERB, { layout: StandardLayouts.stereo });
    expect(expectFailureCode(kernel.setParameter('size', 0.5))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('decay', 31))).toBe('node.parameter-invalid');
    for (const [name, value] of [
      ['decay', 5],
      ['damping', 20],
      ['pre-delay', 100],
      ['width', 50],
    ] as const) {
      expect(kernel.setParameter(name, value).ok).toBe(true);
    }
  });
});
