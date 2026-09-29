/**
 * Replacing each reusable subgraph with the nodes inside it.
 *
 * A subgraph is a node for whoever places it and a graph for whoever builds it
 * (REQ-ARCH-140). Everything after this step, validation, latency and the
 * plan, reads one flat graph of processing nodes, so none of them has to know
 * that subgraphs exist. An inner node's identifier is prefixed with the
 * subgraph's, `outer/inner`, and an edge that met the subgraph's boundary is
 * rewired to the inner port the boundary names: an edge into a boundary input
 * becomes one edge to each inner port it feeds, and an edge from a boundary
 * output comes from the inner port behind it.
 *
 * The boundary is held to what it declares. A boundary port that names no
 * inner port, or whose layout differs from the inner port's, is refused here,
 * because once the boundary is gone no later step could say which subgraph
 * was wrong.
 */

import { layoutsMatch, type ChannelLayout } from '@audiogubbins/domain';

import {
  GRAPH_DESCRIPTOR_VERSION,
  type EdgeDescriptor,
  type GraphDescriptor,
  type PortDescriptor,
  type ProcessingNodeDescriptor,
  type SubgraphNodeDescriptor,
} from './descriptor.js';
import { refusalOf, type GraphDiagnostic, type GraphRefusal } from './diagnostic.js';
import { describeLayout } from './layout-description.js';
import { childNodeId, type NodeId, type PortReference } from './node-id.js';

/** A graph of processing nodes alone, which is what flattening leaves. */
export interface FlatGraph extends GraphDescriptor {
  readonly nodes: readonly ProcessingNodeDescriptor[];
}

/** A graph with its subgraphs expanded, or the reasons it could not be. */
export type GraphFlattening = { readonly ok: true; readonly graph: FlatGraph } | GraphRefusal;

/** What expanding a graph writes, shared by every level of the expansion. */
interface Expansion {
  readonly nodes: ProcessingNodeDescriptor[];
  readonly byId: Map<NodeId, ProcessingNodeDescriptor>;
  readonly edges: EdgeDescriptor[];
  readonly diagnostics: GraphDiagnostic[];
}

/**
 * A placed subgraph's boundary, resolved to the flattened ports behind it. A
 * boundary port that could not be resolved is present with nothing behind it,
 * its problem already reported, so an edge meeting it is not reported again.
 */
interface Boundary {
  readonly inputs: ReadonlyMap<string, readonly PortReference[]>;
  readonly outputs: ReadonlyMap<string, PortReference | undefined>;
}

/** Resolves the references written inside one graph to flattened ports. */
interface Scope {
  source(reference: PortReference, missing: () => void): PortReference | undefined;
  targets(reference: PortReference, missing: () => void): readonly PortReference[];
}

function qualified(prefix: NodeId | undefined, id: NodeId): NodeId {
  return prefix === undefined ? id : childNodeId(prefix, id);
}

function boundaryProblem(subgraph: NodeId, port: string, message: string): GraphDiagnostic {
  return { code: 'subgraph-boundary-invalid', message, node: subgraph, port };
}

/** Why a boundary port's layout does not fit the inner port behind it, if it does not. */
function layoutProblem(
  subgraph: NodeId,
  name: string,
  declared: ChannelLayout,
  inner: PortReference,
  port: PortDescriptor | undefined,
  direction: 'input' | 'output',
): GraphDiagnostic | undefined {
  if (port === undefined) {
    return boundaryProblem(
      subgraph,
      name,
      `The boundary ${direction} "${name}" names ${inner.node}.${inner.port}, which is not an ${direction} port inside the subgraph. Name an inner ${direction} port that exists.`,
    );
  }
  if (layoutsMatch(port.layout, declared)) return undefined;
  return boundaryProblem(
    subgraph,
    name,
    `The boundary ${direction} "${name}" declares ${describeLayout(declared)}, but ${inner.node}.${inner.port} carries ${describeLayout(port.layout)}. Declare the inner port's layout, or insert a channel-map or matrix node inside the subgraph.`,
  );
}

/** Reports each boundary name used twice on one side. */
function duplicateNames(subgraph: NodeId, names: readonly string[], out: Expansion): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      out.diagnostics.push(
        boundaryProblem(
          subgraph,
          name,
          `The subgraph declares the boundary port "${name}" twice. Give each boundary port on one side its own name.`,
        ),
      );
    }
    seen.add(name);
  }
}

function resolveInputs(
  node: SubgraphNodeDescriptor,
  id: NodeId,
  inner: Scope,
  out: Expansion,
): ReadonlyMap<string, readonly PortReference[]> {
  const inputs = new Map<string, readonly PortReference[]>();
  for (const input of node.inputs) {
    const report = (message: string): void => {
      out.diagnostics.push(boundaryProblem(id, input.name, message));
    };
    if (input.to.length === 0) {
      report(
        `The boundary input "${input.name}" feeds nothing inside the subgraph. Connect it to an inner input port, or remove it.`,
      );
    }
    const targets = input.to.flatMap((reference) =>
      inner.targets(reference, () => {
        report(
          `The boundary input "${input.name}" names ${reference.node}.${reference.port}, which is not a boundary input of that inner subgraph.`,
        );
      }),
    );
    const problems = targets.flatMap((target) => {
      const port = out.byId.get(target.node)?.inputs.find((one) => one.name === target.port);
      return layoutProblem(id, input.name, input.layout, target, port, 'input') ?? [];
    });
    out.diagnostics.push(...problems);
    if (!inputs.has(input.name)) inputs.set(input.name, problems.length === 0 ? targets : []);
  }
  return inputs;
}

function resolveOutputs(
  node: SubgraphNodeDescriptor,
  id: NodeId,
  inner: Scope,
  out: Expansion,
): ReadonlyMap<string, PortReference | undefined> {
  const outputs = new Map<string, PortReference | undefined>();
  for (const output of node.outputs) {
    const source = inner.source(output.from, () => {
      out.diagnostics.push(
        boundaryProblem(
          id,
          output.name,
          `The boundary output "${output.name}" names ${output.from.node}.${output.from.port}, which is not a boundary output of that inner subgraph.`,
        ),
      );
    });
    const port =
      source === undefined
        ? undefined
        : out.byId.get(source.node)?.outputs.find((one) => one.name === source.port);
    const problem =
      source === undefined
        ? undefined
        : layoutProblem(id, output.name, output.layout, source, port, 'output');
    if (problem !== undefined) out.diagnostics.push(problem);
    if (!outputs.has(output.name)) {
      outputs.set(output.name, problem === undefined ? source : undefined);
    }
  }
  return outputs;
}

/** A scope over one graph's placed subgraphs, whose other references are only prefixed. */
function scopeOf(prefix: NodeId | undefined, placed: ReadonlyMap<NodeId, Boundary>): Scope {
  return {
    source: (reference, missing) => {
      const boundary = placed.get(reference.node);
      if (boundary === undefined)
        return { node: qualified(prefix, reference.node), port: reference.port };
      if (!boundary.outputs.has(reference.port)) missing();
      return boundary.outputs.get(reference.port);
    },
    targets: (reference, missing) => {
      const boundary = placed.get(reference.node);
      if (boundary === undefined)
        return [{ node: qualified(prefix, reference.node), port: reference.port }];
      const targets = boundary.inputs.get(reference.port);
      if (targets === undefined) missing();
      return targets ?? [];
    },
  };
}

function placeSubgraph(
  node: SubgraphNodeDescriptor,
  id: NodeId,
  ancestors: ReadonlySet<GraphDescriptor>,
  out: Expansion,
): Boundary | undefined {
  if (ancestors.has(node.graph)) {
    out.diagnostics.push({
      code: 'subgraph-recursive',
      message: 'This subgraph contains itself, so it has no end. Place a copy of it instead.',
      node: id,
    });
    return undefined;
  }
  const inner = expand(node.graph, id, new Set([...ancestors, node.graph]), out);
  duplicateNames(
    id,
    node.inputs.map((input) => input.name),
    out,
  );
  duplicateNames(
    id,
    node.outputs.map((output) => output.name),
    out,
  );
  return {
    inputs: resolveInputs(node, id, inner, out),
    outputs: resolveOutputs(node, id, inner, out),
  };
}

function missingBoundary(subgraph: NodeId, port: string, direction: string): GraphDiagnostic {
  return {
    code: 'edge-port-missing',
    message: `The subgraph ${subgraph} has no boundary ${direction} named "${port}". Connect the edge to one it declares.`,
    node: subgraph,
    port,
  };
}

function expand(
  graph: GraphDescriptor,
  prefix: NodeId | undefined,
  ancestors: ReadonlySet<GraphDescriptor>,
  out: Expansion,
): Scope {
  const placed = new Map<NodeId, Boundary>();
  for (const node of graph.nodes) {
    const id = qualified(prefix, node.id);
    if (node.kind === 'processing') {
      const flattened = { ...node, id };
      out.nodes.push(flattened);
      if (!out.byId.has(id)) out.byId.set(id, flattened);
      continue;
    }
    const boundary = placeSubgraph(node, id, ancestors, out);
    if (boundary !== undefined && !placed.has(node.id)) placed.set(node.id, boundary);
  }
  const scope = scopeOf(prefix, placed);
  for (const edge of graph.edges) {
    const from = scope.source(edge.from, () => {
      out.diagnostics.push(
        missingBoundary(qualified(prefix, edge.from.node), edge.from.port, 'output'),
      );
    });
    const targets = scope.targets(edge.to, () => {
      out.diagnostics.push(missingBoundary(qualified(prefix, edge.to.node), edge.to.port, 'input'));
    });
    if (from !== undefined) out.edges.push(...targets.map((to) => ({ from, to })));
  }
  return scope;
}

/**
 * Expands every subgraph in a graph, however deeply nested, into one graph of
 * processing nodes, or refuses it with every boundary problem found.
 */
export function flattenGraph(graph: GraphDescriptor): GraphFlattening {
  const out: Expansion = { nodes: [], byId: new Map(), edges: [], diagnostics: [] };
  expand(graph, undefined, new Set([graph]), out);
  return (
    refusalOf(out.diagnostics) ?? {
      ok: true,
      graph: { version: GRAPH_DESCRIPTOR_VERSION, nodes: out.nodes, edges: out.edges },
    }
  );
}
