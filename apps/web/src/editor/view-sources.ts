/**
 * Where a view's frame is drawn from: the stores an editor surface reads, and
 * the one reading of them each frame takes, so every part of a frame is read
 * at the same moment. Also where a playing view scrolls to keep the playhead
 * in sight, as its follow mode says.
 */

import type { SampleCount } from '@audiogubbins/domain';
import {
  FollowMode,
  type EditorPalette,
  type EditorType,
  type EditorViewState,
} from '@audiogubbins/editor-view';
import { boundaryAt, pixelOf, type SelectionSet } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { ReferencePicture } from '../picture/reference-picture.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { CueStore } from '../state/cue-store.js';
import type { EditorViewStore } from '../state/editor-view-store.js';
import type { Observable } from '../state/observable.js';
import { stripImages } from './picture-strip.js';
import type { SceneSources } from './view-scene.js';

/** The stores and readings an editor surface draws from. */
export interface SurfaceStores {
  readonly editorViews: Pick<EditorViewStore, 'get' | 'subscribe' | 'entry' | 'measured'>;
  readonly selections: Observable<unknown> & { readonly of: (asset: string) => SelectionSet };
  readonly cues: Pick<CueStore, 'get' | 'subscribe'>;
  /** The assets a view opens, whose markers and regions change with the project. */
  readonly assets: Pick<AssetCatalogue, 'find' | 'subscribe'>;
  readonly picture: Pick<ReferencePicture, 'get' | 'subscribe' | 'filmstrip'>;
  /** What the transport is doing, which moves the playhead. */
  readonly audio: Observable<unknown>;
  /** Where an asset's playhead is now. */
  readonly playhead: (asset: EditorAsset) => SampleCount;
  /** Whether the transport is playing asset `asset`. */
  readonly playing: (asset: string) => boolean;
}

/** What one frame of panel `panel` is drawn from, but the audio and the drag, or nothing to draw. */
export function viewSources(
  stores: SurfaceStores,
  panel: string,
  look: { readonly palette: EditorPalette; readonly type: EditorType },
): Omit<SceneSources, 'audio' | 'preview' | 'snap'> | undefined {
  const entry = stores.editorViews.entry(panel);
  const asset = entry === undefined ? undefined : stores.assets.find(entry.asset);
  if (entry === undefined || asset === undefined) return undefined;
  const picture = stores.picture.get();
  const bound = picture.asset === asset.id ? picture.binding : undefined;
  const { state } = entry;
  const filmstrip = stores.picture.filmstrip;
  const ready = picture.media.kind === 'ready' ? picture.media : undefined;
  return {
    state,
    asset,
    selection: stores.selections.of(asset.id),
    playhead: stores.playhead(asset),
    picture: bound,
    thumbnails: (area) =>
      bound === undefined ||
      ready === undefined ||
      filmstrip === undefined ||
      !state.overlays.filmstrip
        ? []
        : stripImages(area, state.viewport, asset.length, {
            binding: bound,
            filmstrip,
            duration: ready.duration,
            aspect: ready.width / Math.max(1, ready.height),
          }),
    palette: look.palette,
    type: look.type,
  };
}

/**
 * Where a playing view scrolls to keep `playhead` in sight, as a boundary to
 * place at its left edge, or `undefined` where it need not move: a page on
 * once the playhead leaves the view, or the playhead held in the middle.
 */
export function followingScroll(
  state: EditorViewState,
  playhead: SampleCount | undefined,
  length: SampleCount,
): SampleCount | undefined {
  if (playhead === undefined) return undefined;
  const { viewport } = state;
  const x = pixelOf(viewport, playhead);
  switch (state.follow) {
    case FollowMode.Off:
      return undefined;
    case FollowMode.Page:
      return x < 0 || x >= viewport.width ? playhead : undefined;
    case FollowMode.Centre: {
      const offset = Math.round(x - viewport.width / 2);
      return offset === 0 ? undefined : boundaryAt(viewport, offset, length);
    }
  }
}
