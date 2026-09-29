/**
 * Which source feeds which graph input, checked before anything is made.
 *
 * Every graph input needs a source, every source a graph input, and each
 * source must already be what its input's port carries: the same channel
 * layout, at the context's rate. Real-time playback converts nothing
 * implicitly (REQ-ARCH-085): a source at another rate would play at the wrong
 * pitch, and converting it here would be a resampling nobody chose, so the
 * caller converts it explicitly, with the engine's `resampledSource`, and
 * decides the quality. Every problem is reported at once.
 */

import {
  channelCount,
  failure,
  FailureKind,
  fail,
  layoutsMatch,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { ExecutionPlan, NodeId } from '@audiogubbins/audio-graph';
import { BuiltInNodeType, type PcmSource } from '@audiogubbins/audio-engine';

/** A graph input and the source that feeds it, in the layout of the input's port. */
export interface BoundSource {
  readonly node: NodeId;
  readonly source: PcmSource;
  readonly layout: ChannelLayout;
}

function refusal(code: string, summary: string, node: NodeId): DomainFailure {
  return failure(code, FailureKind.Rejected, summary, { details: { node } });
}

/** Why `source` cannot feed an input whose port carries `layout`, or `undefined` where it can. */
function mismatch(
  node: NodeId,
  source: PcmSource,
  layout: ChannelLayout,
  rate: number,
): DomainFailure | undefined {
  if (!layoutsMatch(source.layout, layout)) {
    return refusal(
      'playback.source-layout-mismatch',
      `The source for ${node} has ${String(channelCount(source.layout))} channels in its layout, ` +
        `and the graph input's port ${String(channelCount(layout))} in its own; map the channels ` +
        'explicitly in the graph.',
      node,
    );
  }
  if (source.sampleRate !== rate) {
    return refusal(
      'playback.source-rate-mismatch',
      `The source for ${node} runs at ${String(source.sampleRate)} Hz and the audio context at ` +
        `${String(rate)} Hz. Playback does not resample implicitly; convert the source ` +
        "explicitly with the engine's resampledSource first.",
      node,
    );
  }
  return undefined;
}

/** Each graph input of `plan` with its source, or every reason they do not pair up. */
export function bindSources(
  plan: ExecutionPlan,
  sources: ReadonlyMap<NodeId, PcmSource>,
  rate: number,
): DomainResult<readonly BoundSource[]> {
  const bound: BoundSource[] = [];
  const problems: DomainFailure[] = [];
  const inputs = new Set<NodeId>();
  for (const step of plan.steps) {
    if (step.type !== BuiltInNodeType.GraphInput) continue;
    inputs.add(step.node);
    const source = sources.get(step.node);
    const layout = step.outputs[0]?.layout;
    if (source === undefined) {
      problems.push(
        refusal(
          'playback.source-missing',
          `Graph input ${step.node} has no source to play.`,
          step.node,
        ),
      );
    } else if (layout === undefined) {
      problems.push(
        refusal(
          'playback.input-without-port',
          `Graph input ${step.node} has no output port to feed.`,
          step.node,
        ),
      );
    } else {
      const problem = mismatch(step.node, source, layout, rate);
      if (problem === undefined) bound.push({ node: step.node, source, layout });
      else problems.push(problem);
    }
  }
  for (const node of sources.keys()) {
    if (!inputs.has(node)) {
      problems.push(
        refusal(
          'playback.source-unbound',
          `A source was given for ${node}, which is not a graph input of the graph.`,
          node,
        ),
      );
    }
  }
  const [first, ...rest] = problems;
  return first === undefined ? succeed(bound) : fail(first, ...rest);
}
