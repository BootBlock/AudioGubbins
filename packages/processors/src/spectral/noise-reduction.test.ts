import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  chainOutputLayout,
  instantiateProcessor,
  sampleRate,
  unsafeBrandId,
  type ChannelLayout,
  type ProcessorState,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { chirp, noise, noisySine } from '@audiogubbins/test-fixtures';

import {
  TEST_RATE,
  processorKernel,
  processorKernelOf,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { advanced, learnedProfile, noiseOf } from '../testing/spectral-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { PROCESSOR_CATALOGUE } from '../catalogue.js';
import { NOISE_REDUCTION } from './noise-reduction.js';

const FIRST_ORDER = setLayout(1, 'sn3d');

/** Half a second of each channel of `layout`, each its own: a tone in noise or a sweep. */
function programme(layout: ChannelLayout): Float32Array[] {
  return layout.roles.map((_, channel) => {
    const source = channel % 2 === 0 ? noisySine(440 + channel * 110) : chirp();
    return (source.channels[0] ?? new Float32Array(0)).slice(0, TEST_RATE / 2);
  });
}

function sameBits(left: readonly Float32Array[], right: readonly Float32Array[]): boolean {
  return left.every(
    (channel, index) => fingerprint(channel) === fingerprint(right[index] ?? channel),
  );
}

const largest = (channels: readonly Float32Array[]) =>
  Math.max(
    ...channels.map((channel) => channel.reduce((most, x) => Math.max(most, Math.abs(x)), 0)),
  );

describe('noise reduction', () => {
  const stereo = StandardLayouts.stereo;
  const profile = learnedProfile(stereo, noiseOf(stereo));

  it('refuses a profile learned with other frames, at another rate, on other channels, or malformed', () => {
    const refusal = (state: ProcessorState, values = {}, layout: ChannelLayout = stereo) =>
      expectFailureCode(processorKernelOf(NOISE_REDUCTION, { layout, values, state }));
    expect(refusal(profile, { resolution: '4096' })).toBe('processor.state-refused');
    const elsewhere = learnedProfile(stereo, noiseOf(stereo), {}, 44_100);
    expect(refusal(elsewhere)).toBe('processor.state-refused');
    expect(refusal(profile, {}, StandardLayouts.surround5_1)).toBe('processor.state-refused');
    expect(refusal({ kind: 'mask', values: profile.values })).toBe('processor.state-refused');
    expect(refusal({ ...profile, values: profile.values.slice(0, -1) })).toBe(
      'processor.state-refused',
    );
    expect(refusal({ ...profile, values: [...profile.values.slice(0, -1), -1] })).toBe(
      'processor.state-refused',
    );
    const sentence = processorKernelOf(NOISE_REDUCTION, {
      layout: stereo,
      values: { resolution: '4096' },
      state: profile,
    });
    expect(sentence.ok ? '' : sentence.failures[0].summary).toContain('2048 samples');
  });

  it('shares a profile of one channel with every channel, as a profile of that set twice would', () => {
    const mono = learnedProfile(StandardLayouts.mono, noiseOf(StandardLayouts.mono));
    const twice: ProcessorState = {
      ...mono,
      values: [2_048, 48_000, 2, ...mono.values.slice(3), ...mono.values.slice(3)],
    };
    const input = programme(stereo);
    expect(
      sameBits(
        runProcessor(NOISE_REDUCTION, { layout: stereo, state: mono }, input),
        runProcessor(NOISE_REDUCTION, { layout: stereo, state: twice }, input),
      ),
    ).toBe(true);
  });

  it('writes, as the removed noise alone, what the reduction took from its input', () => {
    const input = programme(stereo);
    const values = { reduction: 30, sensitivity: 6 };
    const reduced = runProcessor(
      NOISE_REDUCTION,
      { layout: stereo, values, state: profile },
      input,
    );
    const removed = runProcessor(
      NOISE_REDUCTION,
      { layout: stereo, values: { ...values, mode: 'noise' }, state: profile },
      input,
    );
    for (const [channel, samples] of reduced.entries()) {
      const sum = advanced(
        samples.map((sample, frame) => sample + (removed[channel]?.[frame] ?? 0)),
        2_047,
      );
      let worst = 0;
      for (let frame = 0; frame < sum.length - 2_047; frame += 1) {
        worst = Math.max(worst, Math.abs((sum[frame] ?? 0) - (input[channel]?.[frame] ?? 0)));
      }
      expect(worst).toBeLessThan(1e-6);
      expect(largest([removed[channel] ?? new Float32Array(0)])).toBeGreaterThan(0.01);
    }
  });

  it('gives an ambisonic set one gain a bin, so a field keeps its directions, and speakers their own', () => {
    // The same sound in W and X, the noise learned in W alone: by gains of
    // their own the components would part, and the source would move.
    const tone = (noisySine(700).channels[0] ?? new Float32Array(0)).slice(0, TEST_RATE / 2);
    const stretch = [
      noise(40, { length: TEST_RATE, amplitude: 0.1 }).channels[0] ?? new Float32Array(0),
      new Float32Array(TEST_RATE),
      new Float32Array(TEST_RATE),
      new Float32Array(TEST_RATE),
    ];
    const input = [
      tone,
      tone.map((sample) => sample * 0.5),
      new Float32Array(tone.length),
      new Float32Array(tone.length),
    ];
    const ratio = (layout: ChannelLayout) => {
      const [w, x] = runProcessor(
        NOISE_REDUCTION,
        { layout, values: { reduction: 30 }, state: learnedProfile(layout, stretch) },
        input,
      );
      let worst = 0;
      for (let frame = 4_096; frame < tone.length; frame += 1)
        worst = Math.max(worst, Math.abs((x?.[frame] ?? 0) - 0.5 * (w?.[frame] ?? 0)));
      return worst;
    };
    expect(ratio(FIRST_ORDER)).toBeLessThan(1e-6);
    expect(ratio(StandardLayouts.quadraphonic)).toBeGreaterThan(0.01);
  });

  it('declares N − 1 frames of latency at each resolution, where an impulse comes out', () => {
    for (const [option, size] of [
      ['1024', 1_024],
      ['4096', 4_096],
      ['8192', 8_192],
    ] as const) {
      const values = { resolution: option, reduction: 0 };
      const settings = {
        values: processorValues(NOISE_REDUCTION, values),
        sampleRate: TEST_RATE,
        quality: MAXIMUM_QUALITY.settings,
      };
      expect(NOISE_REDUCTION.descriptor.latency(settings)).toEqual({
        kind: 'known',
        frames: size - 1,
      });
      const impulse = new Float32Array(3 * size);
      impulse[size] = 1;
      const [out] = runProcessor(
        NOISE_REDUCTION,
        {
          layout: StandardLayouts.mono,
          values,
          state: learnedProfile(StandardLayouts.mono, noiseOf(StandardLayouts.mono), values),
        },
        [impulse],
      );
      expect(out?.findIndex((sample) => Math.abs(sample) > 0.5)).toBe(2 * size - 1);
    }
  });

  it('settles within its lead-in when started part way through a stream', () => {
    const mono = StandardLayouts.mono;
    const monoProfile = learnedProfile(mono, noiseOf(mono));
    const values = { smoothing: 100, reduction: 40 };
    const input = programme(mono);
    const leadIn = NOISE_REDUCTION.descriptor.leadIn({
      values: processorValues(NOISE_REDUCTION, values),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    });
    const start = 20_000;
    const [whole] = runProcessor(
      NOISE_REDUCTION,
      { layout: mono, values, state: monoProfile },
      input,
    );
    const [late] = runProcessor(
      NOISE_REDUCTION,
      { layout: mono, values, state: monoProfile },
      input.map((channel) => channel.slice(start - leadIn)),
    );
    let worst = 0;
    for (let frame = leadIn; frame < (late?.length ?? 0); frame += 1) {
      worst = Math.max(
        worst,
        Math.abs((late?.[frame] ?? 0) - (whole?.[start - leadIn + frame] ?? 0)),
      );
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('moves its reduction while it plays, to the same bits however the stream is cut', () => {
    const input = programme(stereo);
    const change = { frame: 9_001, name: 'reduction', value: 40 };
    const steady = runProcessor(
      NOISE_REDUCTION,
      { layout: stereo, state: profile },
      input,
      [4_096],
      change,
    );
    const cut = runProcessor(
      NOISE_REDUCTION,
      { layout: stereo, state: profile },
      input,
      [1, 7, 128, 333, 31],
      change,
    );
    expect(sameBits(cut, steady)).toBe(true);
    const [unmoved] = runProcessor(NOISE_REDUCTION, { layout: stereo, state: profile }, input);
    expect(unmoved?.slice(0, 9_001)).toEqual(steady[0]?.slice(0, 9_001));
    expect(unmoved?.slice(12_000)).not.toEqual(steady[0]?.slice(12_000));
  });

  it('refuses a change of output or resolution while it runs, or a reduction outside its range', () => {
    for (const kernel of [
      processorKernel(NOISE_REDUCTION, { layout: stereo }).kernel,
      expectSuccess(processorKernelOf(NOISE_REDUCTION, { layout: stereo, state: profile })),
    ]) {
      expect(expectFailureCode(kernel.setParameter('mode', 1))).toBe('node.parameter-unknown');
      expect(expectFailureCode(kernel.setParameter('resolution', 4_096))).toBe(
        'node.parameter-unknown',
      );
      expect(expectFailureCode(kernel.setParameter('reduction', 61))).toBe(
        'node.parameter-invalid',
      );
      for (const [name, value] of [
        ['reduction', 30],
        ['sensitivity', 9],
        ['smoothing', 10],
      ] as const) {
        expect(kernel.setParameter(name, value).ok).toBe(true);
      }
    }
  });

  it('cannot be planned in a chain without a profile, or with one learned at another rate', () => {
    // Without a profile the kernel only delays its input, so a plan that let
    // the slot through would render the noise as if nothing were there.
    const slot = instantiateProcessor(
      unsafeBrandId<'ProcessorId'>('0000feed-00c1'),
      NOISE_REDUCTION.descriptor,
    );
    const layoutOf = (state?: ProcessorState) =>
      chainOutputLayout(
        { slots: [state === undefined ? slot : { ...slot, state }] },
        PROCESSOR_CATALOGUE,
        stereo,
        TEST_RATE,
      );
    expect(expectSuccess(layoutOf(profile))).toEqual(stereo);
    const missing = layoutOf();
    expect(expectFailureCode(missing)).toBe('processor.state-missing');
    expect(missing.ok ? '' : missing.failures[0].summary).toContain('noise profile');
    const elsewhere = learnedProfile(stereo, noiseOf(stereo), {}, 44_100);
    expect(expectFailureCode(layoutOf(elsewhere))).toBe('processor.state-refused');
  });

  it('reads a profile learned at the rate its audio runs at, whatever that rate is', () => {
    const rate = expectSuccess(sampleRate(44_100));
    const at = learnedProfile(StandardLayouts.mono, noiseOf(StandardLayouts.mono), {}, 44_100);
    expect(
      processorKernelOf(NOISE_REDUCTION, {
        layout: StandardLayouts.mono,
        sampleRate: rate,
        state: at,
      }).ok,
    ).toBe(true);
  });
});
