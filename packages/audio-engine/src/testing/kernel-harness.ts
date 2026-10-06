/**
 * Nodes, plan steps and kernel contexts for testing node implementations.
 *
 * A node type is checked against a descriptor and run from the plan step made
 * of it, so a test builds the one and derives the other here, rather than
 * compiling a graph around every node it looks at. The blocks it feeds a
 * kernel give each channel its own signal, so a dropped, truncated or swapped
 * channel changes the result, and the blocks it takes output in start full of
 * stale audio, so a frame a kernel failed to write is seen.
 */

import {
  ZERO_SAMPLES,
  StandardLayouts,
  labelledLayout,
  sampleRate,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  nodeId,
  type NodeId,
  type PlanStep,
  type PortDescriptor,
  type ProcessingNodeDescriptor,
  type SettingValue,
} from '@audiogubbins/audio-graph';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import type {
  InputFeed,
  KernelContext,
  MeterTarget,
  NodeImplementation,
  NodeKernel,
  SinkTarget,
} from '../nodes/node-implementation.js';
import { allocateBlock, blockView, type AudioFrameBlock } from '../pcm/frame-block.js';

export const RATE: SampleRate = expectSuccess(sampleRate(48_000));

/** The most frames a test context gives one call of a kernel. */
const BLOCK_FRAMES = 128;

/** A custom map, whose channels only their labels tell apart. */
export const STEMS: ChannelLayout = expectSuccess(labelledLayout(['dialogue', 'music', 'effects']));

/** Every layout a layout-generic type is held to, named for a test's title. */
export const GENERIC_LAYOUTS: readonly (readonly [string, ChannelLayout])[] = [
  ['mono', StandardLayouts.mono],
  ['stereo', StandardLayouts.stereo],
  ['5.1', StandardLayouts.surround5_1],
  ['a labelled custom map', STEMS],
];

/** What a kernel's stale output holds before it writes, which no kernel here produces. */
const STALE = 7;

export function id(value: string): NodeId {
  return expectSuccess(nodeId(value));
}

export function port(name: string, layout: ChannelLayout): PortDescriptor {
  return { name, layout };
}

interface NodeParts {
  readonly inputs?: readonly PortDescriptor[];
  readonly outputs?: readonly PortDescriptor[];
  readonly settings?: Readonly<Record<string, SettingValue>>;
}

/** A node of a type, identified as `node` unless named. */
export function nodeOf(
  type: string,
  parts: NodeParts = {},
  identifier = 'node',
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id: id(identifier),
    type,
    inputs: parts.inputs ?? [],
    outputs: parts.outputs ?? [],
    settings: parts.settings ?? {},
  };
}

/** The step a plan makes of a node, with slots in port order and no input delay or latency. */
export function stepOf(node: ProcessingNodeDescriptor): PlanStep {
  return {
    node: node.id,
    type: node.type,
    settings: node.settings,
    inputs: node.inputs.map((one, slot) => ({
      port: one.name,
      layout: one.layout,
      slot,
      delay: ZERO_SAMPLES,
    })),
    outputs: node.outputs.map((one, slot) => ({
      port: one.name,
      layout: one.layout,
      slot: node.inputs.length + slot,
    })),
    inputArrival: { kind: 'known', frames: ZERO_SAMPLES },
  };
}

/** What the host binds, where a test binds anything. */
export interface Bindings {
  readonly dsp?: CanonicalDsp;
  readonly feeds?: ReadonlyMap<NodeId, InputFeed>;
  readonly sinks?: ReadonlyMap<NodeId, SinkTarget>;
  readonly meters?: ReadonlyMap<NodeId, MeterTarget>;
}

/** A context at {@link RATE} and {@link BLOCK_FRAMES}, on the reference DSP unless another is given. */
export function kernelContext(bindings: Bindings = {}): KernelContext {
  return {
    sampleRate: RATE,
    blockFrames: BLOCK_FRAMES,
    dsp: bindings.dsp ?? REFERENCE_DSP,
    feedFor: (node) => bindings.feeds?.get(node),
    sinkFor: (node) => bindings.sinks?.get(node),
    meterFor: (node) => bindings.meters?.get(node),
  };
}

/** The kernel of a node, which the test expects to be made. */
export function kernelOf(
  implementation: NodeImplementation,
  node: ProcessingNodeDescriptor,
  context: KernelContext = kernelContext(),
): NodeKernel {
  return expectSuccess(implementation.createKernel(stepOf(node), context));
}

/** Sample `frame` of channel `channel` of a {@link distinctBlock}: each channel its own ramp, exact in f32. */
export function distinctSample(channel: number, frame: number): number {
  return ((channel + 1) * 1000 + frame) / 65_536;
}

/** A block of `frames` frames whose channels all differ, starting `start` frames into the signal. */
export function distinctBlock(layout: ChannelLayout, frames: number, start = 0): AudioFrameBlock {
  const block = allocateBlock(layout, RATE, frames);
  block.channels.forEach((channel, index) => {
    for (let frame = 0; frame < frames; frame += 1) {
      channel[frame] = distinctSample(index, start + frame);
    }
  });
  return block;
}

/** A block of the given channels, one array each. */
export function blockOf(
  layout: ChannelLayout,
  channels: readonly (readonly number[])[],
): AudioFrameBlock {
  return {
    layout,
    sampleRate: RATE,
    frames: channels[0]?.length ?? 0,
    channels: channels.map((values) => Float32Array.from(values)),
  };
}

/** A block of `frames` frames holding stale audio, for a kernel to write over. */
function staleBlock(layout: ChannelLayout, frames: number): AudioFrameBlock {
  const block = allocateBlock(layout, RATE, frames);
  for (const channel of block.channels) channel.fill(STALE);
  return block;
}

/**
 * Runs a kernel over whole input blocks in calls of the given sizes, repeated
 * until the input is used, each into a fresh stale output, and answers each
 * output's channels over the whole run.
 */
export function runInCalls(
  kernel: NodeKernel,
  inputs: readonly AudioFrameBlock[],
  outputs: readonly ChannelLayout[],
  total: number,
  sizes: readonly number[],
): Float32Array[][] {
  const collected = outputs.map((layout) => layout.roles.map(() => new Float32Array(total)));
  let start = 0;
  for (let call = 0; start < total; call += 1) {
    const frames = Math.min(sizes[call % sizes.length] ?? total, total - start);
    const pieces = inputs.map((input) => blockView(input, start, frames));
    const written = outputs.map((layout) => staleBlock(layout, frames));
    kernel.process(pieces, written, frames);
    written.forEach((block, output) => {
      block.channels.forEach((channel, index) => collected[output]?.[index]?.set(channel, start));
    });
    start += frames;
  }
  return collected;
}
