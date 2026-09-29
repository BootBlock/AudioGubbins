/**
 * The changes a project command makes to a project state, each giving a new
 * state and leaving the one it was given as it was (REQ-ARCH-153).
 *
 * Each keeps the aggregate's invariants by construction: an asset is added and
 * removed with its source, and an asset's storage key is always the one
 * {@link storageKeyOf} gives for its media, so a state these produce reads
 * back through the project document (REQ-STOR-026).
 */

import type { Asset, AssetId } from '@audiogubbins/domain';
import {
  storageKeyOf,
  type AssetSource,
  type MediaSource,
  type ProjectState,
} from '@audiogubbins/project-format';

/** The state with the project renamed. */
export function withProjectName(state: ProjectState, displayName: string): ProjectState {
  return { ...state, project: { ...state.project, displayName } };
}

/** The state with an asset and its source added. */
export function withAsset(state: ProjectState, asset: Asset, source: AssetSource): ProjectState {
  return {
    project: { ...state.project, assets: new Map(state.project.assets).set(asset.id, asset) },
    sources: new Map(state.sources).set(asset.id, source),
  };
}

/** The state without an asset or its source. */
export function withoutAsset(state: ProjectState, assetId: AssetId): ProjectState {
  const assets = new Map(state.project.assets);
  assets.delete(assetId);
  const sources = new Map(state.sources);
  sources.delete(assetId);
  return { project: { ...state.project, assets }, sources };
}

/** The state with an asset renamed. */
export function withAssetName(
  state: ProjectState,
  asset: Asset,
  displayName: string,
): ProjectState {
  const assets = new Map(state.project.assets).set(asset.id, { ...asset, displayName });
  return { ...state, project: { ...state.project, assets } };
}

/**
 * The state with an asset's bytes found through other media, its storage key
 * following, and its provenance kept: how it came into the project is not
 * changed by where its bytes are now kept.
 */
export function withMedia(
  state: ProjectState,
  asset: Asset,
  source: AssetSource,
  media: MediaSource,
): ProjectState {
  const moved: Asset = { ...asset, storageKey: storageKeyOf(asset.id, media) };
  return withAsset(state, moved, { ...source, media });
}
