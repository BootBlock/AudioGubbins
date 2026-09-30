/**
 * What a node type promises the graph.
 *
 * The graph defines no node type of its own. The engine defines each one as an
 * object that states this contract and makes its kernel, so a type is checked
 * and run by one definition rather than by two tables that could disagree
 * (ADR-0030). The graph asks a contract what it can know without running
 * anything: what the node does to the graph's shape, whether its ports and
 * settings are well formed, and how late its output is.
 */

import type { ProcessorLatency, SampleRate } from '@audiogubbins/domain';

import type { ProcessingNodeDescriptor } from './descriptor.js';
import type { GraphDiagnostic } from './diagnostic.js';

/**
 * Where a node sits in the flow of audio, which decides the ports it may have.
 *
 * A source has outputs only, a processor has both, and an analysis node and a
 * sink have inputs only. The two ends differ in what they are for: a sink is
 * where the graph's audio is delivered, so a graph needs one and the graph's
 * latency is measured at it; an analysis node only observes.
 */
export const NodeRole = {
  Source: 'source',
  Processor: 'processor',
  Analysis: 'analysis',
  Sink: 'sink',
} as const;

/** Where a node sits in the flow of audio. */
export type NodeRole = (typeof NodeRole)[keyof typeof NodeRole];

/** One node type's contract with the graph. */
export interface NodeContract {
  /** The type a node descriptor names to be processed by this contract. */
  readonly type: string;
  readonly role: NodeRole;

  /** Problems with this node's ports, settings or supported layouts; empty when it is well formed. */
  check(node: ProcessingNodeDescriptor): readonly GraphDiagnostic[];

  /**
   * Frames of delay at the graph's rate, or unknown with a reason, in the
   * domain's one {@link ProcessorLatency}, which a processor's descriptor and a
   * chain's latency also use.
   */
  latency(node: ProcessingNodeDescriptor, sampleRate: SampleRate): ProcessorLatency;
}

/** The node contracts a graph is checked against, by type. */
export type NodeCatalogue = ReadonlyMap<string, NodeContract>;
