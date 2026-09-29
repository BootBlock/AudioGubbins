/**
 * Which source feeds which graph input, checked before anything is made.
 *
 * A source is described rather than handed over, since the feeder worker
 * makes it (`feeder/feeder-sources.ts`), in the layout of its input's port.
 * Every graph input needs a source, every source a graph input, and each must
 * already be at the context's rate. Real-time playback converts nothing
 * implicitly (REQ-ARCH-085): a source at another rate would play at the wrong
 * pitch, and converting it here would be a resampling nobody chose, so the
 * caller converts it explicitly and decides the quality. Recorded audio must
 * have as many channels as the port. Every problem is reported at once.
 */

import {
  channelCount,
  failure,
  FailureKind,
  fail,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { ExecutionPlan, NodeId } from '@audiogubbins/audio-graph';
import { BuiltInNodeType, PcmDescriptionKind } from '@audiogubbins/audio-engine';

import type { SourceDescription } from '../protocol/source-descriptions.js';

/** A graph input and the description of the source that feeds it, in the layout of the input's port. */
export interface BoundSource {
  readonly node: NodeId;
  readonly description: SourceDescription;
  readonly layout: ChannelLayout;
}

function refusal(code: string, summary: string, node: NodeId): DomainFailure {
  return failure(code, FailureKind.Rejected, summary, { details: { node } });
}

/** Why `source` cannot feed an input whose port carries `layout`, or `undefined` where it can. */
function mismatch(
  node: NodeId,
  source: SourceDescription,
  layout: ChannelLayout,
  rate: number,
): DomainFailure | undefined {
  if (source.kind === PcmDescriptionKind.Pcm && source.channels.length !== channelCount(layout)) {
    return refusal(
      'playback.source-layout-mismatch',
      `The source for ${node} has ${String(source.channels.length)} channels, ` +
        `and the graph input's port ${String(channelCount(layout))}; map the channels ` +
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

/** Each source by the graph input it names, with a problem for each input named twice. */
function byNode(
  descriptions: readonly SourceDescription[],
  problems: DomainFailure[],
): ReadonlyMap<NodeId, SourceDescription> {
  const sources = new Map<NodeId, SourceDescription>();
  for (const description of descriptions) {
    if (!sources.has(description.node)) {
      sources.set(description.node, description);
      continue;
    }
    problems.push(
      refusal(
        'playback.source-duplicated',
        `Two sources are given for ${description.node}; a graph input reads one.`,
        description.node,
      ),
    );
  }
  return sources;
}

/** Each graph input of `plan` with its source, or every reason they do not pair up. */
export function bindSources(
  plan: ExecutionPlan,
  descriptions: readonly SourceDescription[],
  rate: number,
): DomainResult<readonly BoundSource[]> {
  const bound: BoundSource[] = [];
  const problems: DomainFailure[] = [];
  const inputs = new Set<NodeId>();
  const sources = byNode(descriptions, problems);
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
      if (problem === undefined) bound.push({ node: step.node, description: source, layout });
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
