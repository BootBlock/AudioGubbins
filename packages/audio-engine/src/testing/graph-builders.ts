/**
 * Graphs and audio stated by name, for the tests of every package that runs
 * one.
 *
 * A test states a graph as built-in nodes and `node.port` wires, so it is about
 * what the graph does rather than how a descriptor is written out.
 */

import type { ChannelLayout } from '@audiogubbins/domain';
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
 * One array per channel of `frames` frames, each exact in f32 and unlike
 * every other channel: channel `c` at frame `i` is
 * `((c + 1) · 1000 + i % 4096) / 65536`.
 */
export function distinctChannels(layout: ChannelLayout, frames: number): Float32Array[] {
  return layout.roles.map((_, channel) =>
    Float32Array.from(
      { length: frames },
      (__, frame) => ((channel + 1) * 1000 + (frame % 4096)) / 65_536,
    ),
  );
}
