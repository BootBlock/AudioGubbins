/**
 * The graph descriptor: a processing graph written down as a value.
 *
 * REQ-ARCH-140 asks for one typed directed graph that can represent serial and
 * parallel paths, splits and mixes, wet/dry and side-chain paths, analysis,
 * render and cache nodes, sends, returns and buses, and reusable subgraphs.
 * The descriptor does that without naming any of them: a node is a type with
 * typed ports and settings, an edge joins an output to an input, and each of
 * those shapes is an arrangement of nodes and edges. What a type means belongs
 * to the node contract the engine supplies for it (ADR-0030).
 *
 * The descriptor is a versioned runtime and interchange type. It crosses into a
 * worker and an AudioWorklet, so it is plain data, and it is not yet a stored
 * format: nothing persists it before the phase that saves processor graphs.
 */

import type { ChannelLayout } from '@audiogubbins/domain';

import type { NodeId, PortReference } from './node-id.js';

/** The version of the descriptor's shape, which a reader refuses to guess past. */
export const GRAPH_DESCRIPTOR_VERSION = 1;

/** A value one setting of a node may hold. */
export type SettingValue = number | boolean | string | readonly number[];

/** One named port and the channel layout that flows through it. */
export interface PortDescriptor {
  readonly name: string;
  readonly layout: ChannelLayout;
}

/** A node that one node contract of the catalogue processes. */
export interface ProcessingNodeDescriptor {
  readonly kind: 'processing';
  readonly id: NodeId;

  /** The node type, which names its contract in the catalogue. */
  readonly type: string;
  readonly inputs: readonly PortDescriptor[];
  readonly outputs: readonly PortDescriptor[];
  readonly settings: Readonly<Record<string, SettingValue>>;
}

/** An input of a placed subgraph, and the inner input ports it feeds. */
export interface SubgraphInput {
  readonly name: string;
  readonly layout: ChannelLayout;
  readonly to: readonly PortReference[];
}

/** An output of a placed subgraph, and the inner output port it comes from. */
export interface SubgraphOutput {
  readonly name: string;
  readonly layout: ChannelLayout;
  readonly from: PortReference;
}

/**
 * A reusable subgraph placed as one node.
 *
 * Its boundary is ports like any node's, so the graph that places it connects
 * it as it would a processor, and flattening replaces it with its inner nodes.
 */
export interface SubgraphNodeDescriptor {
  readonly kind: 'subgraph';
  readonly id: NodeId;
  readonly graph: GraphDescriptor;
  readonly inputs: readonly SubgraphInput[];
  readonly outputs: readonly SubgraphOutput[];
}

/** One node of a graph. */
export type NodeDescriptor = ProcessingNodeDescriptor | SubgraphNodeDescriptor;

/** A connection from one node's output port to another's input port. */
export interface EdgeDescriptor {
  readonly from: PortReference;
  readonly to: PortReference;
}

/** A processing graph as a value. */
export interface GraphDescriptor {
  readonly version: typeof GRAPH_DESCRIPTOR_VERSION;
  readonly nodes: readonly NodeDescriptor[];
  readonly edges: readonly EdgeDescriptor[];
}
