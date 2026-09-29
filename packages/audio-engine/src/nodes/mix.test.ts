import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import {
  GENERIC_LAYOUTS,
  RATE,
  blockOf,
  distinctBlock,
  distinctSample,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { MIX_NODE } from './mix.js';

function mix(
  layout: ChannelLayout,
  inputs: number,
  settings: Readonly<Record<string, SettingValue>> = {},
) {
  return nodeOf(BuiltInNodeType.Mix, {
    inputs: Array.from({ length: inputs }, (_, index) => port(`in-${String(index + 1)}`, layout)),
    outputs: [port('out', layout)],
    settings,
  });
}

function codes(node: ReturnType<typeof mix>) {
  return MIX_NODE.check(node).map((one) => one.code);
}

describe('the mix node', () => {
  it('accepts inputs of the output’s layout, with or without gains, of no latency', () => {
    expect(MIX_NODE.check(mix(StandardLayouts.stereo, 1))).toEqual([]);
    expect(MIX_NODE.check(mix(StandardLayouts.stereo, 3, { gains: [1, 0.5, -2] }))).toEqual([]);
    expect(MIX_NODE.latency(mix(StandardLayouts.stereo, 2), RATE)).toEqual({
      kind: 'known',
      frames: ZERO_SAMPLES,
    });
  });

  it('reports each malformed shape with its own code', () => {
    expect(codes(mix(StandardLayouts.stereo, 2, { gains: [1] }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(codes(mix(StandardLayouts.stereo, 1, { gains: 1 }))).toEqual(['node-settings-invalid']);
    expect(codes(mix(StandardLayouts.stereo, 1, { level: 1 }))).toEqual(['node-settings-invalid']);
    expect(
      codes(
        nodeOf(BuiltInNodeType.Mix, {
          inputs: [port('in-1', StandardLayouts.stereo), port('in-2', StandardLayouts.mono)],
          outputs: [port('out', StandardLayouts.stereo)],
        }),
      ),
    ).toEqual(['layout-unsupported']);
    expect(
      codes(
        nodeOf(BuiltInNodeType.Mix, {
          inputs: [port('in-1', StandardLayouts.stereo)],
          outputs: [port('out', StandardLayouts.stereo), port('spare', StandardLayouts.stereo)],
        }),
      ),
    ).toEqual(['role-ports-invalid']);
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`sums every ${name} channel of its inputs, each scaled, in port order`, () => {
      const gains = [0.5, -1, 0.3];
      const starts = [0, 500, 900];
      const kernel = kernelOf(MIX_NODE, mix(layout, 3, { gains }));
      const inputs = starts.map((start) => distinctBlock(layout, 200, start));
      const [out] = runInCalls(kernel, inputs, [layout], 200, [128]);
      const expected = layout.roles.map((_, index) =>
        Float32Array.from({ length: 200 }, (_, frame) =>
          starts.reduce(
            (sum, start, input) =>
              sum + Math.fround(distinctSample(index, start + frame)) * (gains[input] ?? 0),
            0,
          ),
        ),
      );
      expect(out).toEqual(expected);
    });
  }

  it('accumulates in f64 and rounds once, keeping what f32 steps would lose', () => {
    const small = 2 ** -24;
    const kernel = kernelOf(MIX_NODE, mix(StandardLayouts.mono, 3));
    const inputs = [[1], [small], [small]].map((values) => blockOf(StandardLayouts.mono, [values]));
    const [out] = runInCalls(kernel, inputs, [StandardLayouts.mono], 1, [1]);
    const f32Steps = Math.fround(Math.fround(1 + small) + small);
    expect(f32Steps).toBe(1);
    expect(out?.[0]?.[0]).toBe(1 + 2 ** -23);
  });

  it('has no parameters', () => {
    const kernel = kernelOf(MIX_NODE, mix(StandardLayouts.stereo, 2));
    expect(expectFailureCode(kernel.setParameter('gains', 1))).toBe('node.parameter-unknown');
  });
});
