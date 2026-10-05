/**
 * The sources a render message describes, made in the worker.
 *
 * A source object cannot cross a thread, so the main thread describes each
 * graph input's audio and the worker makes it here: recorded audio as a memory
 * source over the arrays it was transferred, which are read in place and never
 * copied whole, and generated audio from its recipe with the worker's own DSP.
 * Each is made in the layout of the input's port, which is why the description
 * carries none, and an edited sound runs its plan's chains as `processing`
 * says: canonically for a render or a peak, from part way for a preview.
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
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  describedSource,
  type CanonicalDsp,
  type PcmSource,
  type PlanProcessing,
} from '@audiogubbins/audio-engine';

import type { SourceDescription } from '../protocol/source-descriptions.js';

function unplaced(node: NodeId): DomainFailure {
  return failure(
    'render.source-unplaced',
    FailureKind.Rejected,
    `A source is bound to ${node}, which is not one of the graph's inputs; bind it to one of them.`,
    { details: { node } },
  );
}

function duplicated(node: NodeId): DomainFailure {
  return failure(
    'render.source-duplicated',
    FailureKind.Rejected,
    `Two sources are bound to ${node}; a graph input reads one.`,
    { details: { node } },
  );
}

/**
 * A source for each description, by node, or every reason one cannot be made.
 * On failure it releases what it made; on success the caller releases them.
 */
export function makeSources(
  descriptions: readonly SourceDescription[],
  inputs: ReadonlyMap<NodeId, ChannelLayout>,
  dsp: CanonicalDsp,
  processing: PlanProcessing,
): DomainResult<ReadonlyMap<NodeId, PcmSource>> {
  const made = new Map<NodeId, PcmSource>();
  const problems: DomainFailure[] = [];
  for (const description of descriptions) {
    const layout = inputs.get(description.node);
    if (layout === undefined) {
      problems.push(unplaced(description.node));
    } else if (made.has(description.node)) {
      problems.push(duplicated(description.node));
    } else {
      const source = describedSource(description, layout, dsp, processing);
      if (source.ok) made.set(description.node, source.value);
      else problems.push(...source.failures);
    }
  }
  const [first, ...rest] = problems;
  if (first === undefined) return succeed(made);
  for (const source of made.values()) source.release();
  return fail(first, ...rest);
}
