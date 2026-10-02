/**
 * The assets an editor view can open this session: the deterministic test
 * assets, and the sound of a reference picture once the browser has decoded
 * it (REQ-AUDIO-156).
 *
 * A catalogue rather than a project: none of these is an asset of the project,
 * and nothing here is saved, which the editor says, until audio is imported
 * into a project at its own rate (ADR-0047, ADR-0021). A view names its asset
 * by identity, so a view restored from an earlier visit whose asset is not open
 * again says so and offers the list.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { DomainResult } from '@audiogubbins/domain';

import type { EditorAsset } from '../assets/editor-asset.js';
import { observable, type Observable } from './observable.js';

/** What the catalogue holds. */
export interface AssetCatalogueState {
  readonly assets: readonly EditorAsset[];
  /** Why an asset that should be here is not, in sentences a reader is shown. */
  readonly problems: readonly string[];
}

/** The assets open this session. */
export interface AssetCatalogue extends Observable<AssetCatalogueState> {
  /** The asset of identity `id`, or `undefined` where none is open. */
  readonly find: (id: string) => EditorAsset | undefined;
  /** Adds an asset, or takes the place of the one of its identity. */
  readonly add: (asset: EditorAsset) => void;
}

/** Makes the catalogue from the assets every session has, saying why any could not be made. */
export function createAssetCatalogue(
  initial: DomainResult<readonly EditorAsset[]>,
  logger: Logger,
): AssetCatalogue {
  const problems = initial.ok ? [] : initial.failures.map((one) => one.summary);
  for (const reason of problems) logger.error('A test asset could not be made.', { reason });
  const state = observable<AssetCatalogueState>({
    assets: initial.ok ? initial.value : [],
    problems,
  });
  return {
    get: state.get,
    subscribe: state.subscribe,
    find: (id) => state.get().assets.find((asset) => asset.id === id),
    add: (asset) => {
      state.update((current) => {
        const index = current.assets.findIndex((each) => each.id === asset.id);
        const assets = index < 0 ? [...current.assets, asset] : current.assets.with(index, asset);
        return { ...current, assets };
      });
    },
  };
}
