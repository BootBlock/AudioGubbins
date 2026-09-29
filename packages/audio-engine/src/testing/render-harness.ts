/**
 * Graphs, sources and sinks for the render tests.
 *
 * A render test states a graph as a list of built-in nodes and `node.port`
 * wires, binds sources and sinks by node name, and reads back every frame a
 * sink was written, so each test is about what it renders rather than how a
 * job is put together.
 */

import { sampleCount, sampleRate, type ChannelLayout, type SampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  GRAPH_DESCRIPTOR_VERSION,
  nodeId,
  type EdgeDescriptor,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
  type SettingValue,
} from '@audiogubbins/audio-graph';

import { MAXIMUM_RENDER_QUALITY, type RenderJob, type RenderSink } from '../render/render-job.js';
import { frameBlock, type AudioFrameBlock } from '../pcm/frame-block.js';
import { memorySource } from '../pcm/memory-source.js';
import type { PcmSource } from '../pcm/pcm-source.js';

const RENDER_RATE: SampleRate = expectSuccess(sampleRate(48_000));

export function named(value: string): NodeId {
  return expectSuccess(nodeId(value));
}

/** A built-in node with one port layout for every input and output it names. */
export function nodeOf(
  name: string,
  type: string,
  layout: ChannelLayout,
  ports: { readonly inputs?: readonly string[]; readonly outputs?: readonly string[] },
  settings: Readonly<Record<string, SettingValue>> = {},
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id: named(name),
    type,
    inputs: (ports.inputs ?? []).map((port) => ({ name: port, layout })),
    outputs: (ports.outputs ?? []).map((port) => ({ name: port, layout })),
    settings,
  };
}

/** A wire from `node.port` to `node.port`. */
export function wire(from: string, to: string): EdgeDescriptor {
  const [fromNode = '', fromPort = ''] = from.split('.');
  const [toNode = '', toPort = ''] = to.split('.');
  return {
    from: { node: named(fromNode), port: fromPort },
    to: { node: named(toNode), port: toPort },
  };
}

export function graphOf(
  nodes: readonly ProcessingNodeDescriptor[],
  edges: readonly EdgeDescriptor[],
): GraphDescriptor {
  return { version: GRAPH_DESCRIPTOR_VERSION, nodes, edges };
}

/**
 * A block of `frames` frames whose channels all differ and are exact in f32:
 * channel `c` at frame `i` is `((c + 1) · 1000 + i % 4096) / 65536`.
 */
export function distinctAudio(
  layout: ChannelLayout,
  frames: number,
  rate: SampleRate = RENDER_RATE,
): AudioFrameBlock {
  const channels = layout.roles.map((_, channel) =>
    Float32Array.from(
      { length: frames },
      (__, frame) => ((channel + 1) * 1000 + (frame % 4096)) / 65_536,
    ),
  );
  return expectSuccess(frameBlock(layout, rate, channels));
}

export function sourceOf(block: AudioFrameBlock): PcmSource {
  return expectSuccess(memorySource(block));
}

/** A sink that keeps every frame written to it, one array per channel. */
export interface CollectingSink extends RenderSink {
  readonly channels: () => readonly Float32Array[];
  readonly writes: () => number;
}

export function collectingSink(): CollectingSink {
  const parts: Float32Array[][] = [];
  let writes = 0;
  return {
    write: (block) => {
      writes += 1;
      block.channels.forEach((channel, index) => {
        (parts[index] ??= []).push(channel.slice(0, block.frames));
      });
      return Promise.resolve();
    },
    channels: () =>
      parts.map((pieces) => {
        const whole = new Float32Array(pieces.reduce((total, piece) => total + piece.length, 0));
        let at = 0;
        for (const piece of pieces) {
          whole.set(piece, at);
          at += piece.length;
        }
        return whole;
      }),
    writes: () => writes,
  };
}

/** A job over the given graph, binding sources and sinks by node name. */
export function jobOf(
  graph: GraphDescriptor,
  bindings: {
    readonly sources?: Readonly<Record<string, PcmSource>>;
    readonly sinks: Readonly<Record<string, RenderSink>>;
    readonly length: number;
    readonly start?: number;
    readonly chunkFrames?: number;
  },
): RenderJob {
  return {
    graph,
    sampleRate: RENDER_RATE,
    sources: new Map(
      Object.entries(bindings.sources ?? {}).map(([node, source]) => [named(node), source]),
    ),
    sinks: new Map(Object.entries(bindings.sinks).map(([node, sink]) => [named(node), sink])),
    range: {
      start: expectSuccess(sampleCount(bindings.start ?? 0)),
      length: expectSuccess(sampleCount(bindings.length)),
    },
    quality: MAXIMUM_RENDER_QUALITY,
    chunkFrames: bindings.chunkFrames ?? 4_096,
  };
}
