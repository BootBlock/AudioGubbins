import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  ZERO_SAMPLES,
  channelCount,
  labelledLayout,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import {
  GENERIC_LAYOUTS,
  RATE,
  STEMS,
  distinctBlock,
  distinctSample,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { CHANNEL_MAP_NODE } from './channel-map.js';

function channelMap(
  from: ChannelLayout,
  to: ChannelLayout,
  settings: Readonly<Record<string, SettingValue>>,
) {
  return nodeOf(BuiltInNodeType.ChannelMap, {
    inputs: [port('in', from)],
    outputs: [port('out', to)],
    settings,
  });
}

function codes(node: ReturnType<typeof channelMap>) {
  return CHANNEL_MAP_NODE.check(node).map((one) => one.code);
}

/** What a map of `from` into `to` gives: output channel k is input channel map[k]. */
function mapped(from: ChannelLayout, to: ChannelLayout, map: readonly number[]): void {
  const frames = 150;
  const kernel = kernelOf(CHANNEL_MAP_NODE, channelMap(from, to, { map }));
  const [out] = runInCalls(kernel, [distinctBlock(from, frames)], [to], frames, [64]);
  expect(out).toHaveLength(channelCount(to));
  expect(out).toEqual(
    map.map((source) =>
      Float32Array.from({ length: frames }, (_, frame) => distinctSample(source, frame)),
    ),
  );
}

describe('the channel map node', () => {
  it('accepts a map with an input channel for each output channel, of no latency', () => {
    const node = channelMap(StandardLayouts.stereo, StandardLayouts.stereo, { map: [1, 0] });
    expect(CHANNEL_MAP_NODE.check(node)).toEqual([]);
    expect(CHANNEL_MAP_NODE.latency(node, RATE)).toEqual({ kind: 'known', frames: ZERO_SAMPLES });
  });

  it('reports each malformed shape with its own code', () => {
    const stereo = StandardLayouts.stereo;
    expect(codes(channelMap(stereo, stereo, {}))).toEqual(['node-settings-invalid']);
    expect(codes(channelMap(stereo, stereo, { map: [0] }))).toEqual(['node-settings-invalid']);
    expect(codes(channelMap(stereo, stereo, { map: [0, 2] }))).toEqual(['node-settings-invalid']);
    expect(codes(channelMap(stereo, stereo, { map: [0, 0.5] }))).toEqual(['node-settings-invalid']);
    expect(codes(channelMap(stereo, stereo, { map: [0, 1], order: 1 }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(
      codes(
        nodeOf(BuiltInNodeType.ChannelMap, {
          inputs: [port('in', stereo), port('also', stereo)],
          outputs: [port('out', stereo)],
          settings: { map: [0, 1] },
        }),
      ),
    ).toEqual(['role-ports-invalid']);
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`passes every ${name} channel through an identity map`, () => {
      mapped(
        layout,
        layout,
        layout.roles.map((_, index) => index),
      );
    });
  }

  it('reorders', () => {
    mapped(StandardLayouts.surround5_1, StandardLayouts.surround5_1, [5, 4, 3, 2, 1, 0]);
    mapped(STEMS, expectSuccess(labelledLayout(['effects', 'dialogue', 'music'])), [2, 0, 1]);
  });

  it('extracts fewer channels', () => {
    mapped(StandardLayouts.surround5_1, StandardLayouts.mono, [2]);
    mapped(STEMS, expectSuccess(labelledLayout(['music'])), [1]);
  });

  it('duplicates a channel', () => {
    mapped(StandardLayouts.mono, StandardLayouts.stereo, [0, 0]);
    mapped(StandardLayouts.stereo, StandardLayouts.quadraphonic, [0, 1, 0, 1]);
  });

  it('has no parameters', () => {
    const kernel = kernelOf(
      CHANNEL_MAP_NODE,
      channelMap(StandardLayouts.mono, StandardLayouts.mono, { map: [0] }),
    );
    expect(expectFailureCode(kernel.setParameter('map', 0))).toBe('node.parameter-unknown');
  });
});
