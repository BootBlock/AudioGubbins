/**
 * Deciding whether a graph can be run, and in what order.
 *
 * Validation composes the steps that each own one rule, flattening, the node
 * checks, the edge checks and the ordering, and is the only maker of a
 * {@link ValidatedGraph}. Everything after it takes one, so latency and the
 * plan never meet a graph that has not passed, and never check again what
 * validation decided (REQ-ARCH-140).
 */

import { cyclesAmong } from './cycles.js';
import type { GraphDescriptor, ProcessingNodeDescriptor } from './descriptor.js';
import { refusalOf, type GraphDiagnostic, type GraphRefusal } from './diagnostic.js';
import { checkEdges } from './edge-checks.js';
import { flattenGraph, type FlatGraph } from './flattening.js';
import { checkNodes, type CheckedNode } from './node-checks.js';
import type { NodeCatalogue, NodeContract } from './node-contract.js';
import type { NodeId, PortReference } from './node-id.js';
import { topologicalOrder } from './topological-order.js';

/** Held by a validated graph alone, so that no other code can make one. */
const VALIDATED: unique symbol = Symbol('validated-graph');

/** One node of a validated graph, with the contract it was validated against. */
export interface ValidatedNode {
  readonly descriptor: ProcessingNodeDescriptor;

  /**
   * The contract the node was checked against, kept so that its latency and
   * its kernel come from the same definition as its checks (ADR-0030).
   */
  readonly contract: NodeContract;

  /** The output feeding each input port, in port order. */
  readonly sources: readonly PortReference[];
}

/**
 * A graph that passed validation, flattened and in running order.
 *
 * An alias rather than an interface: a member keyed by a unique symbol is
 * named in an interface by an identifier the compiler numbers afresh on each
 * run, which would make the recorded public contract differ from run to run.
 */
export type ValidatedGraph = {
  readonly [VALIDATED]: true;

  /** The flattened graph, as it was declared. */
  readonly graph: FlatGraph;

  /** Every node, in running order: each after every node that feeds it. */
  readonly nodes: readonly ValidatedNode[];
};

/** A graph that can be run, or every reason it cannot. */
export type GraphValidation = { readonly ok: true; readonly graph: ValidatedGraph } | GraphRefusal;

function cycleDiagnostic(ids: readonly NodeId[]): GraphDiagnostic {
  const [first] = ids;
  const loop = [...ids, first].join(' → ');
  return {
    code: 'cycle',
    message: `The nodes ${loop} feed back into themselves, so none of them can run first. Break the loop by removing one of its edges.`,
    ...(first === undefined ? {} : { node: first }),
  };
}

/** The running order, or the cycles that prevent one. */
function orderOf(
  declared: readonly CheckedNode[],
  connected: readonly { readonly from: PortReference; readonly to: PortReference }[],
): { readonly order: readonly number[]; readonly diagnostics: readonly GraphDiagnostic[] } {
  const indexOf = new Map(declared.map((node, index) => [node.descriptor.id, index]));
  const edges = connected.flatMap((edge) => {
    const [from, to] = [indexOf.get(edge.from.node), indexOf.get(edge.to.node)];
    return from === undefined || to === undefined ? [] : [[from, to] as const];
  });
  const { order, unordered } = topologicalOrder(declared.length, edges);
  const diagnostics = cyclesAmong(unordered, edges).map((cycle) =>
    cycleDiagnostic(cycle.flatMap((index) => declared[index]?.descriptor.id ?? [])),
  );
  return { order, diagnostics };
}

function isReference(source: PortReference | undefined): source is PortReference {
  return source !== undefined;
}

/**
 * One node of a graph in which no rule found a problem, which has therefore a
 * contract and one source for each input.
 */
function validatedNode(
  node: CheckedNode | undefined,
  sources: ReadonlyMap<NodeId, readonly (PortReference | undefined)[]>,
): ValidatedNode {
  const fed = node === undefined ? undefined : sources.get(node.descriptor.id);
  if (node?.contract === undefined || !fed?.every(isReference)) {
    throw new Error('A graph with no problem found left a node without its contract or sources.');
  }
  return { descriptor: node.descriptor, contract: node.contract, sources: fed };
}

/**
 * Validates a graph against the node contracts of a catalogue.
 *
 * Subgraphs are flattened first. Then each node's identifier is its own, its
 * type has a contract, its ports suit its role and its contract accepts it;
 * each edge joins an existing output to an existing input of the same layout;
 * each input has exactly one edge; the graph has a sink; and nothing feeds
 * back into itself. Every problem is reported, in the same order for the same
 * graph.
 */
export function validateGraph(graph: GraphDescriptor, catalogue: NodeCatalogue): GraphValidation {
  const flattening = flattenGraph(graph);
  if (!flattening.ok) return flattening;
  const flat = flattening.graph;

  const nodes = checkNodes(flat.nodes, catalogue);
  const declared = [...nodes.nodes.values()];
  const edges = checkEdges(
    flat.edges,
    new Map(declared.map((node) => [node.descriptor.id, node.descriptor])),
  );
  const ordering = orderOf(declared, edges.connected);

  const refusal = refusalOf([...nodes.diagnostics, ...edges.diagnostics, ...ordering.diagnostics]);
  if (refusal !== undefined) return refusal;
  return {
    ok: true,
    graph: {
      [VALIDATED]: true,
      graph: flat,
      nodes: ordering.order.map((index) => validatedNode(declared[index], edges.sources)),
    },
  };
}
