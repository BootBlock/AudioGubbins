import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';

import {
  GENERIC_LAYOUTS,
  RATE,
  STEMS,
  distinctBlock,
  distinctSample,
  kernelContext,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
  stepOf,
} from '../testing/kernel-harness.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { GRAPH_INPUT_NODE } from './graph-input.js';
import type { InputFeed } from './node-implementation.js';

function graphInput(layout: ChannelLayout = StandardLayouts.stereo) {
  return nodeOf(BuiltInNodeType.GraphInput, { outputs: [port('out', layout)] });
}

/** A feed of `length` frames of distinct audio, then nothing. */
function shortFeed(layout: ChannelLayout, length: number): InputFeed {
  const audio = distinctBlock(layout, length);
  let position = 0;
  return {
    layout,
    fill: (into: AudioFrameBlock) => {
      const count = Math.max(0, Math.min(into.frames, length - position));
      into.channels.forEach((channel, index) => {
        channel.set(audio.channels[index]?.subarray(position, position + count) ?? []);
      });
      position += count;
      return count;
    },
  };
}

describe('the graph input node', () => {
  it('accepts one output and no settings, of no latency', () => {
    const node = graphInput();
    expect(GRAPH_INPUT_NODE.check(node)).toEqual([]);
    expect(GRAPH_INPUT_NODE.latency(node, RATE)).toEqual({ kind: 'known', frames: ZERO_SAMPLES });
  });

  it('refuses a second output and a setting it does not take', () => {
    const two = nodeOf(BuiltInNodeType.GraphInput, {
      outputs: [port('out', StandardLayouts.stereo), port('spare', StandardLayouts.stereo)],
    });
    expect(GRAPH_INPUT_NODE.check(two).map((one) => one.code)).toEqual(['role-ports-invalid']);
    const set = nodeOf(BuiltInNodeType.GraphInput, {
      outputs: [port('out', StandardLayouts.stereo)],
      settings: { gain: 2 },
    });
    const [problem] = GRAPH_INPUT_NODE.check(set);
    expect(problem?.code).toBe('node-settings-invalid');
    expect(problem?.message).toContain('"gain"');
  });

  it('leaves a missing output to the graph’s role check, rather than reporting it twice', () => {
    expect(GRAPH_INPUT_NODE.check(nodeOf(BuiltInNodeType.GraphInput))).toEqual([]);
    expect(
      expectFailureCode(
        GRAPH_INPUT_NODE.createKernel(stepOf(nodeOf(BuiltInNodeType.GraphInput)), kernelContext()),
      ),
    ).toBe('node.ports-invalid');
  });

  it('cannot run without a feed bound to it', () => {
    expect(
      expectFailureCode(GRAPH_INPUT_NODE.createKernel(stepOf(graphInput()), kernelContext())),
    ).toBe('node.feed-unbound');
  });

  it('refuses a feed of another layout rather than converting it unseen', () => {
    const node = graphInput(StandardLayouts.surround5_1);
    const context = kernelContext({
      feeds: new Map([[node.id, shortFeed(StandardLayouts.stereo, 16)]]),
    });
    expect(expectFailureCode(GRAPH_INPUT_NODE.createKernel(stepOf(node), context))).toBe(
      'node.feed-layout-mismatch',
    );
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`passes a feed's ${name} audio through, and silences every frame past its end`, () => {
      const node = graphInput(layout);
      const kernel = kernelOf(
        GRAPH_INPUT_NODE,
        node,
        kernelContext({ feeds: new Map([[node.id, shortFeed(layout, 100)]]) }),
      );
      const [out] = runInCalls(kernel, [], [layout], 256, [64]);
      out?.forEach((channel, index) => {
        for (let frame = 0; frame < 256; frame += 1) {
          expect(channel[frame]).toBe(frame < 100 ? Math.fround(distinctSample(index, frame)) : 0);
        }
      });
    });
  }

  it('silences a whole block when the feed has nothing', () => {
    const node = graphInput(STEMS);
    const kernel = kernelOf(
      GRAPH_INPUT_NODE,
      node,
      kernelContext({ feeds: new Map([[node.id, shortFeed(STEMS, 0)]]) }),
    );
    const [out] = runInCalls(kernel, [], [STEMS], 32, [32]);
    expect(out?.every((channel) => channel.every((sample) => sample === 0))).toBe(true);
  });

  it('has no parameters', () => {
    const node = graphInput();
    const kernel = kernelOf(
      GRAPH_INPUT_NODE,
      node,
      kernelContext({ feeds: new Map([[node.id, shortFeed(StandardLayouts.stereo, 1)]]) }),
    );
    expect(expectFailureCode(kernel.setParameter('gain', 1))).toBe('node.parameter-unknown');
  });
});
