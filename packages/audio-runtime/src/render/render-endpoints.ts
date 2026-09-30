/**
 * Where a render's audio enters and leaves its graph, and in what layout.
 *
 * Both ends of a render worker need it and neither can take it from the other:
 * the worker builds each graph input's source in the layout of the input's
 * port, since the audio crosses as bare planar arrays, and the main thread
 * writes each sink's chunks as blocks in the layout of the sink's port. Read
 * from the flattened graph, so an input or a sink inside a reusable subgraph is
 * found by the qualified identifier the renderer binds it by.
 *
 * A node with the wrong ports is left out rather than refused here: the
 * renderer validates the graph and refuses it with the diagnostic that says
 * why, and a second, vaguer refusal from this reading would only mask it.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  NodeRole,
  flattenGraph,
  type GraphDescriptor,
  type GraphDiagnostic,
  type NodeId,
} from '@audiogubbins/audio-graph';
import { BUILT_IN_NODES, BuiltInNodeType } from '@audiogubbins/audio-engine';

/** The layout of each graph input's audio and each sink's, by node. */
export interface RenderEndpoints {
  readonly inputs: ReadonlyMap<NodeId, ChannelLayout>;
  readonly sinks: ReadonlyMap<NodeId, ChannelLayout>;
}

/** The engine's own refusal of a graph it cannot flatten, so either end reports it alike. */
function refused(diagnostic: GraphDiagnostic): DomainFailure {
  return failure('render.graph-refused', FailureKind.Rejected, diagnostic.message, {
    details: { diagnostic: diagnostic.code },
  });
}

/** The graph's inputs and sinks with their layouts, or why the graph cannot be read. */
export function renderEndpoints(graph: GraphDescriptor): DomainResult<RenderEndpoints> {
  const flat = flattenGraph(graph);
  if (!flat.ok) {
    const [first, ...rest] = flat.diagnostics;
    return fail(refused(first), ...rest.map(refused));
  }
  const inputs = new Map<NodeId, ChannelLayout>();
  const sinks = new Map<NodeId, ChannelLayout>();
  for (const node of flat.graph.nodes) {
    const output = node.outputs[0];
    const input = node.inputs[0];
    if (node.type === BuiltInNodeType.GraphInput && output !== undefined) {
      inputs.set(node.id, output.layout);
    } else if (BUILT_IN_NODES.get(node.type)?.role === NodeRole.Sink && input !== undefined) {
      sinks.set(node.id, input.layout);
    }
  }
  return succeed({ inputs, sinks });
}
