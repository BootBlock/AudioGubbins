/**
 * The peaks of every asset an editor view shows, held for as long as one does.
 *
 * A view's surface holds its asset's peaks too, but a surface lives only as
 * long as its panel's component, and a change to the dock's arrangement mounts
 * every panel again. The peaks must outlive that: their lifetime is the media's
 * identity and revision being shown, not a component's (the packet's rule, and
 * ADR-0043), or a pyramid half made would be dropped and begun again from its
 * first chunk each time a view is opened, moved or resized. So they are held
 * here, from the view store: from when a view first shows an asset until no
 * view shows it.
 */

import type { PeakHandle, PeakHost } from '@audiogubbins/waveform';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { EditorViewStore } from '../state/editor-view-store.js';
import { peakSubjectOf } from './view-audio.js';

function keyOf(asset: EditorAsset): string {
  return `${asset.id}\u0000${asset.revision}`;
}

/**
 * Holds the peaks of each asset `editorViews` shows from now on, and answers
 * the function that lets them all go.
 */
export function holdShownPeaks(
  editorViews: Pick<EditorViewStore, 'get' | 'subscribe'>,
  assets: Pick<AssetCatalogue, 'find' | 'subscribe'>,
  peaks: Pick<PeakHost, 'open'>,
): () => void {
  const held = new Map<string, PeakHandle>();
  const follow = (): void => {
    const shown = new Map<string, EditorAsset>();
    for (const entry of editorViews.get().views.values()) {
      const asset = assets.find(entry.asset);
      if (asset !== undefined) shown.set(keyOf(asset), asset);
    }
    for (const [key, handle] of held) {
      if (shown.has(key)) continue;
      handle.release();
      held.delete(key);
    }
    for (const [key, asset] of shown) {
      if (!held.has(key)) held.set(key, peaks.open(peakSubjectOf(asset)));
    }
  };
  follow();
  const stops = [editorViews.subscribe(follow), assets.subscribe(follow)];
  return () => {
    for (const stop of stops) stop();
    for (const handle of held.values()) handle.release();
    held.clear();
  };
}
