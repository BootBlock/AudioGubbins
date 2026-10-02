/**
 * What a copy takes (ADR-0053): a slice of the plan of the asset or region
 * shown, on the channels chosen, with the record of every asset whose media
 * the slice reads.
 *
 * The slice names immutable sources only, never an operation, so what was
 * copied sounds the same whatever later happens to the asset it came from. The
 * records carry each asset as its source was imported, with no edits, since a
 * payload reads an asset's media and never its chain, and an asset is added to
 * a project unedited; they let a paste into another project bring the media
 * with it.
 */

import {
  slicePlan,
  type ClipboardPayload,
  type DomainResult,
  type EditPlan,
  type EditRange,
  type ProjectId,
  mapResult,
} from '@audiogubbins/domain';
import type { AssetRecord, ProjectState } from '@audiogubbins/project-format';

/** What the clipboard holds after a copy. */
export interface CopiedAudio {
  /** The project it was copied from. */
  readonly origin: ProjectId;
  readonly payload: ClipboardPayload;

  /** The asset of each media source the payload reads, unedited, with its source. */
  readonly records: readonly AssetRecord[];
}

/**
 * `range` of `plan`, the plan of an asset or region of `state`, on `channels`
 * where given (ascending channels of the plan), and every channel where not.
 */
export function copyAudio(
  state: ProjectState,
  plan: EditPlan,
  range: EditRange,
  channels?: readonly number[],
): DomainResult<CopiedAudio> {
  return mapResult(slicePlan(plan, range.start, range.end, channels), (payload) => ({
    origin: state.project.id,
    payload,
    records: recordsRead(state, payload),
  }));
}

/** The record of every asset whose media `payload` reads, in the order first read. */
function recordsRead(state: ProjectState, payload: ClipboardPayload): readonly AssetRecord[] {
  const records = new Map<string, AssetRecord>();
  for (const stream of payload.streams) {
    for (const { source } of stream.segments) {
      if (source.kind !== 'media' || records.has(source.asset)) continue;
      const asset = state.project.assets.get(source.asset);
      const assetSource = state.sources.get(source.asset);
      if (asset === undefined || assetSource === undefined) {
        throw new Error('A plan of the project reads only media the project holds.');
      }
      records.set(source.asset, { asset: { ...asset, edits: [] }, source: assetSource });
    }
  }
  return [...records.values()];
}
