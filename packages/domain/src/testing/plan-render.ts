/**
 * A plan rendered whole from sources held in memory, for a test.
 *
 * Reads each segment's content the way the engine's edited source does,
 * forwards or backwards, and gives it to the domain's own stage arithmetic,
 * so a test comparing this with the edit oracle checks the plan's fold and
 * its arithmetic together. A converted stream needs the canonical resampler,
 * which is the engine's, so its tests render that.
 */

import type { AssetId } from '../identity/branded-id.js';
import type { EditPlan } from '../editing/plan.js';
import { applyStages } from '../editing/stage-arithmetic.js';
import type { Samples } from './edit-oracle.js';

/** The plan's first stream, rendered from `sources`, one array per channel. */
export function renderPlan(plan: EditPlan, sources: ReadonlyMap<AssetId, Samples>): Samples {
  const [stream] = plan.streams;
  const total = stream.segments.reduce((sum, segment) => sum + segment.length, 0);
  const out = stream.layout.roles.map(() => new Float32Array(total));
  let position = 0;
  for (const segment of stream.segments) {
    if (segment.source.kind !== 'media') {
      throw new Error('A converted stream is rendered by the engine’s tests.');
    }
    const source = sources.get(segment.source.asset);
    if (source === undefined) throw new Error(`No samples for ${segment.source.asset}.`);
    const first = segment.reversed ? segment.start + segment.length - 1 : segment.start;
    const step = segment.reversed ? -1 : 1;
    const block = source.map((channel) =>
      Float32Array.from(
        { length: segment.length },
        (_, index) => channel[first + index * step] ?? 0,
      ),
    );
    const result = applyStages(segment.stages, { first, step, frames: segment.length }, block);
    result.forEach((channel, index) => out[index]?.set(channel, position));
    position += segment.length;
  }
  return out;
}
