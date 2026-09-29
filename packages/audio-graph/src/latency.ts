/**
 * Processor latency, carried through the graph, and the delay that keeps
 * parallel paths aligned.
 *
 * REQ-ARCH-144 makes latency a first-class part of the graph from the start:
 * each node's output arrives the latest of its inputs plus its own latency, and
 * where paths of different latency meet, each earlier one is delayed to meet
 * the latest. That is automatic delay compensation, and it is what keeps a
 * wet/dry blend, a side chain or a parallel branch sample-aligned in playback
 * and in an offline render alike.
 *
 * A latency nobody knows cannot be compensated. Where every path into a node
 * passes through the same unknown nodes, the unknown part is common to them and
 * they stay aligned by their known parts. Where it is not, the node is refused,
 * because unknown latency cannot silently enter parallel paths.
 */

import {
  ZERO_SAMPLES,
  addSamples,
  subtractSamples,
  type ProcessorLatency,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { refusalOf, type GraphDiagnostic, type GraphRefusal } from './diagnostic.js';
import { NodeRole } from './node-contract.js';
import type { NodeId } from './node-id.js';
import {
  causesOf,
  framesOf,
  latestOf,
  pathLatency,
  sameCauses,
  unionOfCauses,
  type PathLatency,
} from './path-latency.js';
import type { ValidatedGraph, ValidatedNode } from './validation.js';

/** One node's latency, and the delay each of its inputs needs. */
export interface NodeLatency {
  readonly node: NodeId;

  /** What the node's contract reported of the node itself. */
  readonly processing: ProcessorLatency;

  /** Frames of delay to apply to each input port, in port order, to align it with the latest. */
  readonly compensation: readonly SampleCount[];

  /** How late the node's output is against the graph's sources. */
  readonly arrival: PathLatency;
}

/** The total latency at one sink or analysis node. */
export interface EndpointLatency {
  readonly node: NodeId;
  readonly role: typeof NodeRole.Sink | typeof NodeRole.Analysis;
  readonly latency: PathLatency;
}

/** The latency of every node of a validated graph at one sample rate. */
export interface LatencyAnalysis {
  /** The graph analysed, which the plan is made from. */
  readonly graph: ValidatedGraph;
  readonly sampleRate: SampleRate;

  /** Each node's latency, in the graph's running order. */
  readonly nodes: readonly NodeLatency[];

  /** Each sink and analysis node's total latency, in running order. */
  readonly endpoints: readonly EndpointLatency[];

  /** The latest of the sinks: the graph's latency. */
  readonly overall: PathLatency;
}

/** A graph's latency, or the reasons it cannot be aligned. */
export type LatencyAnalysisResult =
  { readonly ok: true; readonly analysis: LatencyAnalysis } | GraphRefusal;

/** Running order, by node, which orders the unknown nodes of a path. */
type Rank = ReadonlyMap<NodeId, number>;

function mergeRefusal(
  node: ValidatedNode,
  inputs: readonly PathLatency[],
  rank: Rank,
): GraphDiagnostic {
  const unshared = unionOfCauses(inputs, rank).filter(
    (cause) => !inputs.every((input) => causesOf(input).some((one) => one.node === cause.node)),
  );
  const named = unshared.map((cause) => `${cause.node} (${cause.reason})`).join('; ');
  return {
    code: 'unknown-latency-at-merge',
    message: `Node ${node.descriptor.id} joins paths that cannot be aligned, because the latency of ${named} is not known and is not on every path. Give that processor a known latency, or place it before the paths split so that every path passes through it.`,
    node: node.descriptor.id,
  };
}

/** The output's lateness: the aligned inputs' plus the node's own. */
function arrivalAfter(
  incoming: PathLatency,
  processing: ProcessorLatency,
  node: NodeId,
  diagnostics: GraphDiagnostic[],
): PathLatency {
  if (processing.kind === 'unknown') {
    return pathLatency(framesOf(incoming), [
      ...causesOf(incoming),
      { node, reason: processing.reason },
    ]);
  }
  const frames = addSamples(framesOf(incoming), processing.frames);
  if (frames.ok) return pathLatency(frames.value, causesOf(incoming));
  diagnostics.push({
    code: 'latency-out-of-range',
    message: `The latency at node ${node} is more frames than can be counted exactly. Check the latency its processors report.`,
    node,
  });
  return incoming;
}

function delayToMeet(latest: SampleCount, path: PathLatency): SampleCount {
  const delay = subtractSamples(latest, framesOf(path));
  if (!delay.ok) throw new Error('A path was later than the latest of the paths it is among.');
  return delay.value;
}

function analyseNode(
  node: ValidatedNode,
  sampleRate: SampleRate,
  arrivals: ReadonlyMap<NodeId, PathLatency>,
  rank: Rank,
  diagnostics: GraphDiagnostic[],
): NodeLatency {
  const inputs = node.sources.map((source) => {
    const arrival = arrivals.get(source.node);
    if (arrival === undefined) throw new Error('A node was analysed before a node feeding it.');
    return arrival;
  });
  const [first] = inputs;
  if (first !== undefined && !inputs.every((input) => sameCauses(input, first))) {
    diagnostics.push(mergeRefusal(node, inputs, rank));
  }
  const incoming = latestOf(inputs, rank, ZERO_SAMPLES);
  const processing = node.contract.latency(node.descriptor, sampleRate);
  return {
    node: node.descriptor.id,
    processing,
    compensation: inputs.map((input) => delayToMeet(framesOf(incoming), input)),
    arrival: arrivalAfter(incoming, processing, node.descriptor.id, diagnostics),
  };
}

function endpointOf(node: ValidatedNode, latency: NodeLatency): readonly EndpointLatency[] {
  const role = node.contract.role;
  if (role !== NodeRole.Sink && role !== NodeRole.Analysis) return [];
  return [{ node: latency.node, role, latency: latency.arrival }];
}

/**
 * Carries each node's latency through a validated graph at one sample rate,
 * finding the delay each input needs to meet the latest input of its node, or
 * refusing a graph whose paths cannot be aligned.
 */
export function analyseLatency(
  graph: ValidatedGraph,
  sampleRate: SampleRate,
): LatencyAnalysisResult {
  const rank: Rank = new Map(graph.nodes.map((node, index) => [node.descriptor.id, index]));
  const arrivals = new Map<NodeId, PathLatency>();
  const diagnostics: GraphDiagnostic[] = [];
  const nodes: NodeLatency[] = [];
  const endpoints: EndpointLatency[] = [];
  for (const node of graph.nodes) {
    const latency = analyseNode(node, sampleRate, arrivals, rank, diagnostics);
    arrivals.set(latency.node, latency.arrival);
    nodes.push(latency);
    endpoints.push(...endpointOf(node, latency));
  }
  const sinks = endpoints.filter((endpoint) => endpoint.role === NodeRole.Sink);
  const overall = latestOf(
    sinks.map((sink) => sink.latency),
    rank,
    ZERO_SAMPLES,
  );
  return (
    refusalOf(diagnostics) ?? {
      ok: true,
      analysis: { graph, sampleRate, nodes, endpoints, overall },
    }
  );
}
