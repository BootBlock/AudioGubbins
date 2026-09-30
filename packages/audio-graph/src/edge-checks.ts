/**
 * The checks on how a flattened graph's nodes are joined.
 *
 * An edge runs from an output port of a node in the graph to an input port of
 * another, and the two ports carry the same channel layout exactly. A layout is
 * never adapted on the way: REQ-ARCH-157 prohibits silent downmixing and
 * channel truncation, so a change of layout is a node the user places, a
 * channel map or a matrix, never something an edge does. Each input takes one
 * edge, so what it receives is never a sum nobody asked for; an output may feed
 * any number of inputs, or none.
 */

import { layoutsMatch } from '@audiogubbins/domain';

import type { EdgeDescriptor, PortDescriptor, ProcessingNodeDescriptor } from './descriptor.js';
import type { GraphDiagnostic } from './diagnostic.js';
import { describeLayout } from './layout-description.js';
import type { NodeId, PortReference } from './node-id.js';

/** What checking the edges found. */
export interface EdgeCheck {
  /** Each edge whose two ends name ports that exist, in declaration order. */
  readonly connected: readonly EdgeDescriptor[];

  /**
   * For each node, the one edge's source feeding each of its input ports, in
   * port order, where the port has exactly one.
   */
  readonly sources: ReadonlyMap<NodeId, readonly (PortReference | undefined)[]>;
  readonly diagnostics: readonly GraphDiagnostic[];
}

function edgeText(edge: EdgeDescriptor): string {
  return `${edge.from.node}.${edge.from.port} to ${edge.to.node}.${edge.to.port}`;
}

/** The port an edge's end names, or the problem with it. */
function endOf(
  edge: EdgeDescriptor,
  end: 'from' | 'to',
  nodes: ReadonlyMap<NodeId, ProcessingNodeDescriptor>,
): PortDescriptor | GraphDiagnostic {
  const { node: id, port: name } = edge[end];
  const node = nodes.get(id);
  if (node === undefined) {
    return {
      code: 'edge-node-missing',
      message: `The edge from ${edgeText(edge)} names the node ${id}, which is not in the graph. Add the node, or remove the edge.`,
      node: id,
    };
  }
  const [side, other] =
    end === 'from' ? (['outputs', 'inputs'] as const) : (['inputs', 'outputs'] as const);
  const port = node[side].find((one) => one.name === name);
  if (port !== undefined) return port;
  const wrongWay = node[other].some((one) => one.name === name)
    ? ` "${name}" is one of its ${other}, and an edge runs from an output to an input.`
    : '';
  return {
    code: 'edge-port-missing',
    message: `The edge from ${edgeText(edge)} names no port of ${id}'s ${side}.${wrongWay} Connect the edge to a port the node declares.`,
    node: id,
    port: name,
  };
}

function isPort(end: PortDescriptor | GraphDiagnostic): end is PortDescriptor {
  return 'layout' in end;
}

function layoutMismatch(
  edge: EdgeDescriptor,
  from: PortDescriptor,
  to: PortDescriptor,
): GraphDiagnostic | undefined {
  if (layoutsMatch(from.layout, to.layout)) return undefined;
  return {
    code: 'layout-mismatch',
    message: `The edge from ${edgeText(edge)} joins ${describeLayout(from.layout)} to ${describeLayout(to.layout)}. AudioGubbins never downmixes or drops channels silently: insert a channel-map or matrix node between them that converts one layout to the other.`,
    node: edge.to.node,
    port: edge.to.port,
  };
}

/** The problem with how many edges feed one input port, if there is one. */
function feedProblem(
  node: ProcessingNodeDescriptor,
  port: string,
  count: number,
): GraphDiagnostic | undefined {
  if (count === 1) return undefined;
  if (count === 0) {
    return {
      code: 'input-unconnected',
      message: `The input "${port}" of ${node.id} is not connected. Connect an output to it, or remove the node.`,
      node: node.id,
      port,
    };
  }
  return {
    code: 'input-connected-twice',
    message: `The input "${port}" of ${node.id} is fed by ${String(count)} edges. An input takes one edge: to combine signals, feed them to a mix node and connect its output here.`,
    node: node.id,
    port,
  };
}

/** Checks each edge, then how many edges feed each input port. */
export function checkEdges(
  edges: readonly EdgeDescriptor[],
  nodes: ReadonlyMap<NodeId, ProcessingNodeDescriptor>,
): EdgeCheck {
  const diagnostics: GraphDiagnostic[] = [];
  const connected: EdgeDescriptor[] = [];
  const feeding = new Map<NodeId, Map<string, PortReference[]>>();
  for (const edge of edges) {
    const from = endOf(edge, 'from', nodes);
    const to = endOf(edge, 'to', nodes);
    if (!isPort(from)) diagnostics.push(from);
    if (!isPort(to)) diagnostics.push(to);
    if (!isPort(from) || !isPort(to)) continue;
    const mismatch = layoutMismatch(edge, from, to);
    if (mismatch !== undefined) diagnostics.push(mismatch);
    connected.push(edge);
    const ports = feeding.get(edge.to.node) ?? new Map<string, PortReference[]>();
    const fed = ports.get(edge.to.port) ?? [];
    fed.push(edge.from);
    ports.set(edge.to.port, fed);
    feeding.set(edge.to.node, ports);
  }

  const sources = new Map<NodeId, readonly (PortReference | undefined)[]>();
  for (const node of nodes.values()) {
    const fed = node.inputs.map(({ name }) => feeding.get(node.id)?.get(name) ?? []);
    for (const [index, { name }] of node.inputs.entries()) {
      const problem = feedProblem(node, name, fed[index]?.length ?? 0);
      if (problem !== undefined) diagnostics.push(problem);
    }
    sources.set(
      node.id,
      fed.map((one) => (one.length === 1 ? one[0] : undefined)),
    );
  }
  return { connected, sources, diagnostics };
}
