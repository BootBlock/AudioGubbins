/**
 * The public contract of the AudioGubbins processing graph.
 *
 * The typed directed graph as a value, and everything that can be decided from
 * it without running it: the descriptor and its reader, reusable subgraphs,
 * validation with its diagnostics, latency and its compensation, and the
 * execution plan (ADR-0030, REQ-ARCH-140). Each is its own module with one
 * rule to keep, and none is a manager of the others.
 *
 * The package depends on the domain alone. It knows no thread, browser or
 * buffer, and it defines no node type: the engine supplies each type as an
 * object stating its {@link NodeContract}, which the graph checks it against.
 */

export { type NodeId, type PortReference, nodeId } from './node-id.js';

export {
  type EdgeDescriptor,
  GRAPH_DESCRIPTOR_VERSION,
  type GraphDescriptor,
  type NodeDescriptor,
  type PortDescriptor,
  type ProcessingNodeDescriptor,
  type SettingValue,
  type SubgraphInput,
  type SubgraphNodeDescriptor,
  type SubgraphOutput,
} from './descriptor.js';

export { readGraphDescriptor } from './descriptor-reading.js';

export {
  type GraphDiagnostic,
  type GraphDiagnosticCode,
  type GraphDiagnostics,
  type GraphRefusal,
} from './diagnostic.js';

export {
  type NodeCatalogue,
  type NodeContract,
  NodeRole,
  type ProcessorLatency,
} from './node-contract.js';

export { type FlatGraph, type GraphFlattening, flattenGraph } from './flattening.js';

export {
  type GraphValidation,
  type ValidatedGraph,
  type ValidatedNode,
  validateGraph,
} from './validation.js';

export { type PathLatency, type UnknownLatencyCause } from './path-latency.js';

export {
  type EndpointLatency,
  type LatencyAnalysis,
  type LatencyAnalysisResult,
  type NodeLatency,
  analyseLatency,
} from './latency.js';

export {
  type ExecutionPlan,
  type PlanInput,
  type PlanOutput,
  type PlanSink,
  type PlanSlot,
  type PlanStep,
  planGraph,
} from './plan.js';

export { type GraphCompilation, compileGraph } from './compilation.js';
