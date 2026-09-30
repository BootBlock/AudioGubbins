/**
 * From a graph descriptor to a plan the engine can run, in one call.
 *
 * The engine needs the plan and the latency it was made with, and nothing in
 * between, so it asks for both here rather than composing the steps itself and
 * possibly running a plan made from a graph that did not pass.
 */

import type { SampleRate } from '@audiogubbins/domain';

import type { GraphDescriptor } from './descriptor.js';
import type { GraphRefusal } from './diagnostic.js';
import { analyseLatency, type LatencyAnalysis } from './latency.js';
import type { NodeCatalogue } from './node-contract.js';
import { planGraph, type ExecutionPlan } from './plan.js';
import { validateGraph } from './validation.js';

/** A plan ready to run with the latency it compensates, or every reason there is none. */
export type GraphCompilation =
  | { readonly ok: true; readonly plan: ExecutionPlan; readonly latency: LatencyAnalysis }
  | GraphRefusal;

/** Validates a graph, carries its latency through it at a sample rate, and plans it. */
export function compileGraph(
  graph: GraphDescriptor,
  catalogue: NodeCatalogue,
  sampleRate: SampleRate,
): GraphCompilation {
  const validation = validateGraph(graph, catalogue);
  if (!validation.ok) return validation;
  const latency = analyseLatency(validation.graph, sampleRate);
  if (!latency.ok) return latency;
  return { ok: true, plan: planGraph(latency.analysis), latency: latency.analysis };
}
