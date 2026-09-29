import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

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

function gain(layout: ChannelLayout, settings: Readonly<Record<string, number | string>> = {}) {
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

  it('refuses a parameter it does not have, and a factor that is not finite', () => {
    const kernel = kernelOf(GAIN_NODE, gain(StandardLayouts.mono));
    expect(expectFailureCode(kernel.setParameter('pan', 0))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('gain', Number.NaN))).toBe(
      'node.parameter-invalid',
    );
  });
});
