/**
 * What the Inspector shows: whatever the editor last in use acts on. That is
 * the asset or region its view shows, and in a view of an asset the one region
 * selected there, by the rule the region commands follow (`regionsInView`), so
 * a property changed here is changed on the region a command would change.
 */

import {
  anchorResolver,
  placeRegion,
  type Asset,
  type PlacedRegion,
  type Region,
} from '@audiogubbins/domain';
import type { EditorViewState } from '@audiogubbins/editor-view';
import type { AssetSource, ProjectState } from '@audiogubbins/project-format';
import type { SelectionSet } from '@audiogubbins/timeline';

import type { EditorAsset, ProjectOwner } from '../../assets/editor-asset.js';
import { regionsInView } from '../../commands/region-target.js';

/** A region of the project as the Inspector shows it. */
export interface InspectedRegion {
  readonly region: Region;
  /** Where it lies on its asset's timeline as it stands, or `undefined` where its audio is gone. */
  readonly placed: PlacedRegion | undefined;
  /** Whether the view shows the region alone, where a part of it can be looped. */
  readonly shownAlone: boolean;
}

/** What the Inspector shows. */
export type Inspected =
  | { readonly kind: 'nothing' }
  /** Audio of the session, which keeps no edit. */
  | { readonly kind: 'session'; readonly view: EditorAsset }
  | {
      readonly kind: 'project';
      /** The editor panel the commands it runs act in. */
      readonly panel: string;
      readonly view: EditorAsset;
      readonly state: EditorViewState;
      readonly owner: ProjectOwner;
      readonly asset: Asset;
      readonly source: AssetSource | undefined;
      readonly region: InspectedRegion | undefined;
    };

const NOTHING: Inspected = { kind: 'nothing' };

/** What the editor view of `panel` acts on, read from what it shows and what is selected there. */
export function inspected(
  view:
    | {
        readonly panel: string;
        readonly asset: EditorAsset;
        readonly state: EditorViewState;
      }
    | undefined,
  selection: SelectionSet,
  project: ProjectState | undefined,
): Inspected {
  if (view === undefined) return NOTHING;
  const { owner } = view.asset;
  if (owner.kind !== 'project') return { kind: 'session', view: view.asset };
  const [only, ...others] = regionsInView(owner, selection);
  const one =
    only === undefined || others.length > 0 ? undefined : project?.project.regions.get(only);
  return {
    kind: 'project',
    panel: view.panel,
    view: view.asset,
    state: view.state,
    owner,
    asset: owner.asset,
    source: project?.sources.get(owner.asset.id),
    region:
      one === undefined
        ? undefined
        : {
            region: one,
            placed: placeRegion(anchorResolver(owner.asset), one),
            shownAlone: owner.region?.id === one.id,
          },
  };
}
