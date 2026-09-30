/**
 * Each open asset's markers and regions for the session (ADR-0047).
 *
 * Held here, in memory, until the editor opens the project's own assets, which
 * needs audio imported into a project at its own rate (ADR-0021): the interface
 * says the session is not saved, and the removal boundary is that import, when
 * these values and the commands that change them move into the project
 * unchanged. Every view of an asset reads the one entry, so a marker added in
 * one view is shown in all of them (REQ-EDIT-061), and a view's own
 * presentation is untouched by it.
 *
 * Markers change only through the marker commands, each of which gives its
 * inverse (`marker-commands.ts`). Regions come with the asset that defines
 * them and are shown and snapped to; making and editing them is Phase 05's
 * (REQ-EDIT-014).
 */

import {
  FailureKind,
  fail,
  failure,
  mapResult,
  succeed,
  type DomainResult,
  type Marker,
  type MarkerId,
  type Region,
  type SampleCount,
} from '@audiogubbins/domain';

import type { EditorAsset } from '../assets/editor-asset.js';
import { observable, type Observable } from './observable.js';

/** What an asset holds for the session. */
export interface AssetContent {
  /** In position order, the earlier added first at one position. */
  readonly markers: readonly Marker[];
  readonly regions: readonly Region[];
}

/** Every asset's content that has been read or changed, by asset identity. */
export type SessionContentState = ReadonlyMap<string, AssetContent>;

/** The session's content. */
export interface SessionContent extends Observable<SessionContentState> {
  /** `asset`'s content: what it opened with, until a marker command changes it. */
  readonly of: (asset: EditorAsset) => AssetContent;
  /** Adds `marker`, or says why it cannot be added. */
  readonly addMarker: (asset: EditorAsset, marker: Marker) => DomainResult<void>;
  /** Moves a marker, answering where it was. */
  readonly moveMarker: (
    asset: EditorAsset,
    id: MarkerId,
    to: SampleCount,
  ) => DomainResult<SampleCount>;
  /** Removes a marker, answering what it was. */
  readonly removeMarker: (asset: EditorAsset, id: MarkerId) => DomainResult<Marker>;
}

function inOrder(markers: readonly Marker[]): readonly Marker[] {
  // A stable sort, so markers at one position keep the order they were added in.
  return markers.toSorted((one, other) => one.position - other.position);
}

function noSuchMarker(asset: EditorAsset): DomainResult<never> {
  return fail(
    failure(
      'content.marker-missing',
      FailureKind.Conflict,
      `That marker is no longer in ${asset.name}.`,
    ),
  );
}

function outsideAsset(asset: EditorAsset): DomainResult<never> {
  return fail(
    failure(
      'content.marker-outside',
      FailureKind.Rejected,
      `A marker must be placed within ${asset.name}, which ends at frame ${String(asset.length)}.`,
    ),
  );
}

/** `content` with `marker` added, or why it cannot be. */
function withMarker(
  asset: EditorAsset,
  content: AssetContent,
  marker: Marker,
): DomainResult<AssetContent> {
  if (marker.position > asset.length) return outsideAsset(asset);
  if (content.markers.some((each) => each.id === marker.id)) {
    return fail(
      failure(
        'content.marker-exists',
        FailureKind.Conflict,
        `${asset.name} already has that marker.`,
      ),
    );
  }
  return succeed({ ...content, markers: inOrder([...content.markers, marker]) });
}

/** `content` with marker `id` at `to`, and where it was; or why it cannot be. */
function withMarkerMoved(
  asset: EditorAsset,
  content: AssetContent,
  id: MarkerId,
  to: SampleCount,
): DomainResult<readonly [AssetContent, SampleCount]> {
  if (to > asset.length) return outsideAsset(asset);
  const marker = content.markers.find((each) => each.id === id);
  if (marker === undefined) return noSuchMarker(asset);
  if (marker.position === to) return succeed([content, to]);
  const moved = content.markers.map((each) => (each.id === id ? { ...each, position: to } : each));
  return succeed([{ ...content, markers: inOrder(moved) }, marker.position]);
}

/** `content` without marker `id`, and the marker; or why it cannot be. */
function withoutMarker(
  asset: EditorAsset,
  content: AssetContent,
  id: MarkerId,
): DomainResult<readonly [AssetContent, Marker]> {
  const marker = content.markers.find((each) => each.id === id);
  if (marker === undefined) return noSuchMarker(asset);
  return succeed([
    { ...content, markers: content.markers.filter((each) => each.id !== id) },
    marker,
  ]);
}

/** Makes the session's content, empty until an asset is read. */
export function createSessionContent(): SessionContent {
  const state = observable<SessionContentState>(new Map());
  // What an asset opened with, made once for each, so a view that reads an
  // unchanged asset every frame is given the same value every time.
  const opened = new WeakMap<EditorAsset, AssetContent>();

  const of = (asset: EditorAsset): AssetContent => {
    const changed = state.get().get(asset.id);
    if (changed !== undefined) return changed;
    const known = opened.get(asset);
    if (known !== undefined) return known;
    const content = { markers: inOrder(asset.markers), regions: asset.regions };
    opened.set(asset, content);
    return content;
  };

  const replace = (asset: EditorAsset, content: AssetContent): void => {
    if (content === of(asset)) return;
    const next = new Map(state.get());
    next.set(asset.id, content);
    state.set(next);
  };

  return {
    get: state.get,
    subscribe: state.subscribe,
    of,
    addMarker: (asset, marker) =>
      mapResult(withMarker(asset, of(asset), marker), (content) => {
        replace(asset, content);
      }),
    moveMarker: (asset, id, to) =>
      mapResult(withMarkerMoved(asset, of(asset), id, to), ([content, from]) => {
        replace(asset, content);
        return from;
      }),
    removeMarker: (asset, id) =>
      mapResult(withoutMarker(asset, of(asset), id), ([content, marker]) => {
        replace(asset, content);
        return marker;
      }),
  };
}
