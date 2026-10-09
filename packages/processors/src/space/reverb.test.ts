import { describe, expect, it } from 'vitest';

import {
  ChannelRole,
  MAXIMUM_QUALITY,
  StandardLayouts,
  ambisonicComponentOf,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

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
import { ORDERS, encoded, setLayout } from '../testing/space-measures.js';

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** `channels` channels each carrying the same noise, so all the decorrelation is the reverb's. */
function sameNoise(channels: number): Float32Array[] {
  const source = noise(21, { length: 24_000 }).channels[0] ?? new Float32Array(0);
  return Array.from({ length: channels }, () => source.slice());
}

/** The energy of a channel. */
function energyOf(samples: Float32Array | undefined): number {
  let sum = 0;
  for (const sample of samples ?? []) sum += sample * sample;
  return sum;
}

/** `samples` through a one-pole low-pass at `frequency`, twice over. */
function lowPassed(samples: Float32Array, frequency: number): Float32Array {
  const pole = Math.exp((-2 * Math.PI * frequency) / TEST_RATE);
  const out = Float32Array.from(samples);
  for (let pass = 0; pass < 2; pass += 1) {
    let state = 0;
    for (const [frame, sample] of out.entries()) {
      state = (1 - pole) * sample + pole * state;
      out[frame] = state;
    }
  }
  return out;
}

/** Noise placed at `azimuth` and `elevation` in a set of `order` in the convention `key`, reverberated. */
function fieldReverb(
  order: 1 | 2 | 3,
  key: string,
  azimuth: number,
  elevation: number,
  values: Readonly<Record<string, number>> = {},
  length = 24_000,
): Float32Array[] {
  const source = noise(31, { length }).channels[0] ?? new Float32Array(0);
  const [orderKey] = ORDERS[order - 1] ?? ORDERS[0];
  const input = encoded({ azimuth, elevation, order: orderKey, normalisation: key }, source);
  return runProcessor(
    REVERB,
    { layout: setLayout(order, key), values: { 'pre-delay': 0, ...values } },
    input,
  );
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

  it('gives every channel of a layout an equal share of the tail, its low end included', () => {
    // The whole response to an impulse, past the lead-in of a long decay, so
    // a channel that reads its lines before their ends is not counted short.
    const values = { decay: 3, damping: 50, 'pre-delay': 0 };
    for (const layout of [StandardLayouts.stereo, StandardLayouts.surround7_1_4]) {
      const impulse = Float32Array.from({ length: 6 * TEST_RATE }, (_, frame) =>
        frame === 0 ? 1 : 0,
      );
      const tail = runProcessor(
        REVERB,
        { layout, values },
        layout.roles.map(() => impulse),
      );
      const energies = tail.map((channel) => energyOf(channel));
      const mean = energies.reduce((sum, energy) => sum + energy, 0) / energies.length;
      for (const energy of energies) expect(Math.abs(energy / mean - 1)).toBeLessThan(0.1);
      // Below 40 Hz the lines ring nearly in phase; each channel must carry
      // its share of that too, which a few modes hold, so the shares scatter
      // further.
      const lows = tail.map((channel) => energyOf(lowPassed(channel, 40)));
      const lowMean = lows.reduce((sum, energy) => sum + energy, 0) / lows.length;
      for (const low of lows) expect(Math.abs(low / lowMean - 1)).toBeLessThan(0.5);
    }
  });

  it('gives a source behind, beside or above the listener in a sound field the tail of one in front', () => {
    // W carries a source at unit gain from every direction, and the
    // directional components of one behind or beside the listener cancel in
    // any sum of the channels.
    for (const [order, key] of [
      [1, 'sn3d'],
      [2, 'n3d'],
      [3, 'fuma'],
    ] as const) {
      const front = fieldReverb(order, key, 0, 0, {}, 6_000);
      expect(energyOf(front[0])).toBeGreaterThan(0.1);
      for (const [azimuth, elevation] of [
        [180, 0],
        [-90, 0],
        [30, 90],
      ] as const) {
        const moved = fieldReverb(order, key, azimuth, elevation, {}, 6_000);
        expect(moved.map((channel) => fingerprint(channel))).toEqual(
          front.map((channel) => fingerprint(channel)),
        );
      }
    }
  });

  it('writes the tail of a sound field as a diffuse field: decorrelated, at 1 / (2l + 1) of W per component in SN3D', () => {
    for (const key of ['sn3d', 'n3d'] as const) {
      const layout = setLayout(3, key);
      const tail = fieldReverb(3, key, 0, 0);
      const whole = energyOf(tail[0]);
      for (const [channel, samples] of tail.entries()) {
        const degree = ambisonicComponentOf(layout, channel)?.degree ?? 0;
        // N3D weights each degree by √(2l + 1) against SN3D, so a diffuse
        // field holds equal energy in every component.
        const expected = key === 'sn3d' ? 1 / (2 * degree + 1) : 1;
        expect(Math.abs(energyOf(samples) / whole / expected - 1)).toBeLessThan(0.15);
        for (const other of tail.slice(0, channel)) {
          expect(Math.abs(correlation(samples, other))).toBeLessThan(0.3);
        }
      }
    }
  });

  it('narrows the tail of a sound field to W alone at no width', () => {
    const wide = fieldReverb(1, 'sn3d', 45, 20);
    const narrow = fieldReverb(1, 'sn3d', 45, 20, { width: 0 });
    expect(narrow[0]).toEqual(wide[0]);
    for (const component of narrow.slice(1)) expect(energyOf(component)).toBe(0);
  });

  it('refuses a layout that states an ambisonic convention without its full set', () => {
    const partial: ChannelLayout = {
      ...setLayout(1, 'sn3d'),
      roles: [ChannelRole.Ambisonic, ChannelRole.Ambisonic, ChannelRole.Ambisonic],
    };
    const refusal = REVERB.descriptor.outputLayout(partial, processorValues(REVERB, {}));
    expect(expectFailureCode(refusal)).toBe('processor.layout-refused');
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
