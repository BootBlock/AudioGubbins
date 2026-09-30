import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import { rampFrames } from '../execution/parameter-ramp.js';
import {
  GENERIC_LAYOUTS,
  RATE,
  distinctBlock,
  distinctSample,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { GAIN_NODE } from './gain.js';

function gain(layout: ChannelLayout, settings: Readonly<Record<string, SettingValue>> = {}) {
  return nodeOf(BuiltInNodeType.Gain, {
    inputs: [port('in', layout)],
    outputs: [port('out', layout)],
    settings,
  });
}

const RAMP = rampFrames(RATE);

describe('the gain node', () => {
  it('accepts a node with or without a gain, of no latency', () => {
    expect(GAIN_NODE.check(gain(StandardLayouts.stereo))).toEqual([]);
    expect(GAIN_NODE.check(gain(StandardLayouts.stereo, { gain: -0.5 }))).toEqual([]);
    expect(GAIN_NODE.latency(gain(StandardLayouts.stereo), RATE)).toEqual({
      kind: 'known',
      frames: ZERO_SAMPLES,
    });
  });

  it('reports each malformed shape with its own code', () => {
    const codes = (node: ReturnType<typeof gain>) => GAIN_NODE.check(node).map((one) => one.code);
    expect(codes(gain(StandardLayouts.stereo, { gain: 'loud' }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(codes(gain(StandardLayouts.stereo, { level: 1 }))).toEqual(['node-settings-invalid']);
    expect(
      codes(
        nodeOf(BuiltInNodeType.Gain, {
          inputs: [port('in', StandardLayouts.stereo), port('two', StandardLayouts.stereo)],
          outputs: [port('out', StandardLayouts.stereo)],
        }),
      ),
    ).toEqual(['role-ports-invalid']);
    const changed = nodeOf(BuiltInNodeType.Gain, {
      inputs: [port('in', StandardLayouts.stereo)],
      outputs: [port('out', StandardLayouts.surround5_1)],
    });
    const [problem] = GAIN_NODE.check(changed);
    expect(problem?.code).toBe('layout-unsupported');
    expect(problem?.message).toContain('channel-map or matrix');
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`scales every ${name} channel by its factor, a product in f64 stored once`, () => {
      const factor = 1 / 3;
      const kernel = kernelOf(GAIN_NODE, gain(layout, { gain: factor }));
      const [out] = runInCalls(kernel, [distinctBlock(layout, 300)], [layout], 300, [128]);
      let differsFromF32Factor = false;
      out?.forEach((channel, index) => {
        for (let frame = 0; frame < 300; frame += 1) {
          const sample = Math.fround(distinctSample(index, frame));
          expect(channel[frame]).toBe(Math.fround(sample * factor));
          if (Math.fround(sample * factor) !== Math.fround(sample * Math.fround(factor))) {
            differsFromF32Factor = true;
          }
        }
      });
      expect(out).toHaveLength(layout.roles.length);
      expect(differsFromF32Factor).toBe(true);
    });
  }

  it('spreads a change over the ramp, reaching the target exactly, however the blocks fall', () => {
    const layout = StandardLayouts.surround5_1;
    const total = RAMP * 3;
    const input = distinctBlock(layout, total);
    const run = (sizes: readonly number[]) => {
      const kernel = kernelOf(GAIN_NODE, gain(layout, { gain: 1 }));
      expectSuccess(kernel.setParameter('gain', 0.25));
      return runInCalls(kernel, [input], [layout], total, sizes);
    };
    const [whole] = run([128]);
    const expected = layout.roles.map((_, index) =>
      Float32Array.from({ length: total }, (_, frame) => {
        const factor = frame < RAMP ? 1 + (-0.75 * frame) / RAMP : 0.25;
        return Math.fround(distinctSample(index, frame)) * factor;
      }),
    );
    expect(whole).toEqual(expected);
    // The jump is spread: the first frame still has the old factor, the last ramped one is short of the new.
    const first = whole?.[0];
    expect(first?.[0]).toBe(Math.fround(distinctSample(0, 0)));
    expect(first?.[RAMP - 1]).not.toBe(
      Math.fround(Math.fround(distinctSample(0, RAMP - 1)) * 0.25),
    );
    expect(first?.[RAMP]).toBe(Math.fround(Math.fround(distinctSample(0, RAMP)) * 0.25));
    expect(run([1, 7, 128, 33])).toEqual([expected]);
  });

  it('accepts a gain and a polarity for each channel, and refuses lists of the wrong kind', () => {
    const surround = StandardLayouts.surround5_1;
    const codes = (node: ReturnType<typeof gain>) => GAIN_NODE.check(node).map((one) => one.code);
    expect(
      codes(
        gain(surround, {
          'channel-gains': [1, 0.5, 2, 0, -1, 0.25],
          polarity: [1, -1, 1, 1, -1, 1],
        }),
      ),
    ).toEqual([]);
    expect(codes(gain(surround, { 'channel-gains': [1, 0.5] }))).toEqual(['node-settings-invalid']);
    expect(codes(gain(surround, { polarity: [1, -1, 1, 1, 0.5, 1] }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(codes(gain(StandardLayouts.stereo, { polarity: [1, -2] }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(codes(gain(StandardLayouts.stereo, { polarity: true }))).toEqual([
      'node-settings-invalid',
    ]);
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`scales each ${name} channel by the gain, then its own gain and polarity, in f64 stored once`, () => {
      const width = layout.roles.length;
      const channelGains = layout.roles.map((_, index) => 0.3 + index / 7);
      const polarity = layout.roles.map((_, index) => (index % 2 === 0 ? -1 : 1));
      const common = 1 / 3;
      const kernel = kernelOf(
        GAIN_NODE,
        gain(layout, { gain: common, 'channel-gains': channelGains, polarity }),
      );
      const [out] = runInCalls(kernel, [distinctBlock(layout, 200)], [layout], 200, [128]);
      const expected = layout.roles.map((_, index) =>
        Float32Array.from({ length: 200 }, (__, frame) => {
          const factor = (channelGains[index] ?? 0) * (polarity[index] ?? 0);
          return Math.fround(distinctSample(index, frame)) * common * factor;
        }),
      );
      expect(out).toHaveLength(width);
      expect(out).toEqual(expected);
    });
  }

  it('ramps one channel alone when its gain or polarity changes, however the blocks fall', () => {
    const layout = StandardLayouts.surround5_1;
    const total = RAMP * 2;
    const input = distinctBlock(layout, total);
    const run = (sizes: readonly number[]) => {
      const kernel = kernelOf(GAIN_NODE, gain(layout, { gain: 0.5 }));
      // A flip of polarity passes through silence over the ramp rather than jumping.
      expectSuccess(kernel.setParameter('polarity.4', -1));
      expectSuccess(kernel.setParameter('channel-gain.2', 0.25));
      return runInCalls(kernel, [input], [layout], total, sizes);
    };
    const channelFactor = (index: number, frame: number) => {
      if (frame >= RAMP) return index === 4 ? -1 : index === 2 ? 0.25 : 1;
      if (index === 4) return 1 + (-2 * frame) / RAMP;
      if (index === 2) return 1 + (-0.75 * frame) / RAMP;
      return 1;
    };
    const expected = layout.roles.map((_, index) =>
      Float32Array.from(
        { length: total },
        (__, frame) =>
          Math.fround(distinctSample(index, frame)) * 0.5 * channelFactor(index, frame),
      ),
    );
    const [whole] = run([128]);
    expect(whole).toEqual(expected);
    expect(whole?.[4]?.[RAMP / 2]).toBe(0);
    expect(run([1, 7, 128, 33])).toEqual([expected]);
  });

  it('refuses a channel it does not have, and a polarity that is not 1 or -1', () => {
    const kernel = kernelOf(GAIN_NODE, gain(StandardLayouts.stereo));
    expect(expectFailureCode(kernel.setParameter('channel-gain.2', 1))).toBe(
      'node.parameter-unknown',
    );
    expect(expectFailureCode(kernel.setParameter('polarity.0', 0.5))).toBe(
      'node.parameter-invalid',
    );
    expect(expectFailureCode(kernel.setParameter('channel-gain.1', Number.POSITIVE_INFINITY))).toBe(
      'node.parameter-invalid',
    );
    expectSuccess(kernel.setParameter('polarity.1', -1));
    expectSuccess(kernel.setParameter('channel-gain.0', 0));
  });

  it('refuses a parameter it does not have, and a factor that is not finite', () => {
    const kernel = kernelOf(GAIN_NODE, gain(StandardLayouts.mono));
    expect(expectFailureCode(kernel.setParameter('pan', 0))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('gain', Number.NaN))).toBe(
      'node.parameter-invalid',
    );
  });
});
