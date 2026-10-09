/**
 * What a test reads of the takes a project holds: the first take recorded, its
 * asset and how its recording ended.
 */

import type { Asset } from '@audiogubbins/domain';
import type { ProjectState, RecordingEnding } from '@audiogubbins/project-format';

/** The first take of the first stack of `state`, its asset and its recording's ending. */
export function firstRecorded(state: ProjectState): {
  readonly asset: Asset;
  readonly ending: RecordingEnding | undefined;
} {
  const [stack] = state.project.takeStacks.values();
  const take = stack?.takes[0];
  const asset = take === undefined ? undefined : state.project.assets.get(take.asset);
  if (take === undefined || asset === undefined) throw new Error('No take was recorded.');
  return { asset, ending: state.sources.get(take.asset)?.provenance?.recording?.ending };
}
