/**
 * The changes the editing commands make to a project state, each giving a new
 * state and leaving the one it was given as it was (REQ-ARCH-153).
 */

import type { Asset, Marker, MarkerId, Region, RegionId } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

/** The state with an asset's edit chain replaced. */
export function withAssetEdits(
  state: ProjectState,
  asset: Asset,
  edits: Asset['edits'],
): ProjectState {
  const assets = new Map(state.project.assets).set(asset.id, { ...asset, edits });
  return { ...state, project: { ...state.project, assets } };
}

/** The state with a marker added or replaced. */
export function withMarker(state: ProjectState, marker: Marker): ProjectState {
  const markers = new Map(state.project.markers).set(marker.id, marker);
  return { ...state, project: { ...state.project, markers } };
}

/** The state without a marker. */
export function withoutMarker(state: ProjectState, id: MarkerId): ProjectState {
  const markers = new Map(state.project.markers);
  markers.delete(id);
  return { ...state, project: { ...state.project, markers } };
}

/** The state with a region added or replaced. */
export function withRegion(state: ProjectState, region: Region): ProjectState {
  const regions = new Map(state.project.regions).set(region.id, region);
  return { ...state, project: { ...state.project, regions } };
}

/** The state without a region. */
export function withoutRegion(state: ProjectState, id: RegionId): ProjectState {
  const regions = new Map(state.project.regions);
  regions.delete(id);
  return { ...state, project: { ...state.project, regions } };
}
