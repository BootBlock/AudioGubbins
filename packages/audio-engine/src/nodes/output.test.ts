import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';

import {
  GENERIC_LAYOUTS,
  RATE,
  distinctBlock,
  kernelContext,
  kernelOf,
  nodeOf,
  port,
  stepOf,
} from '../testing/kernel-harness.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { OUTPUT_NODE } from './output.js';

function output(layout: ChannelLayout = StandardLayouts.stereo) {
  return nodeOf(BuiltInNodeType.Output, { inputs: [port('in', layout)] });
}

describe('the output node', () => {
  it('accepts one input and no settings, of no latency', () => {
    const node = output();
    expect(OUTPUT_NODE.check(node)).toEqual([]);
    expect(OUTPUT_NODE.latency(node, RATE)).toEqual({ kind: 'known', frames: ZERO_SAMPLES });
  });

  it('refuses a second input and a setting it does not take', () => {
    const two = nodeOf(BuiltInNodeType.Output, {
      inputs: [port('in', StandardLayouts.stereo), port('more', StandardLayouts.stereo)],
    });
    expect(OUTPUT_NODE.check(two).map((one) => one.code)).toEqual(['role-ports-invalid']);
    const set = nodeOf(BuiltInNodeType.Output, {
      inputs: [port('in', StandardLayouts.stereo)],
      settings: { device: 'speakers' },
    });
    expect(OUTPUT_NODE.check(set).map((one) => one.code)).toEqual(['node-settings-invalid']);
  });

  it('cannot run without a target bound to it', () => {
    expect(expectFailureCode(OUTPUT_NODE.createKernel(stepOf(output()), kernelContext()))).toBe(
      'node.sink-unbound',
    );
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`delivers the ${name} block it is given to its target`, () => {
      const node = output(layout);
      const received: AudioFrameBlock[] = [];
      const kernel = kernelOf(
        OUTPUT_NODE,
        node,
        kernelContext({
          sinks: new Map([[node.id, { receive: (block) => received.push(block) }]]),
        }),
      );
      const block = distinctBlock(layout, 32);
      kernel.process([block], [], 32);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(block);
      expect(expectFailureCode(kernel.setParameter('gain', 1))).toBe('node.parameter-unknown');
    });
  }
});
