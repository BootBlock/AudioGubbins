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
 * view shows it. They are the peaks of the render quality in force, so a change
 * of it lets the old ones go and holds the new.
 */

import type { PeakHandle, PeakHost, PeakSubject } from '@audiogubbins/waveform';

import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import type { EditorViewStore } from '../state/editor-view-store.js';
import type { Observable } from '../state/observable.js';
import { peakSubjectOf } from './view-audio.js';

function keyOf(subject: PeakSubject): string {
  return `${subject.identity}\u0000${subject.revision}`;
}

/**
 * Holds the peaks of each asset `editorViews` shows from now on, at the render
 * quality `audioSettings` sets, and answers the function that lets them all go.
 */
export function holdShownPeaks(
  editorViews: Pick<EditorViewStore, 'get' | 'subscribe'>,
  assets: Pick<AssetCatalogue, 'find' | 'subscribe'>,
  audioSettings: Observable<Pick<AudioSettings, 'renderQuality'>>,
  peaks: Pick<PeakHost, 'open'>,
): () => void {
  const held = new Map<string, PeakHandle>();
  const follow = (): void => {
    const shown = new Map<string, PeakSubject>();
    const quality = audioSettings.get().renderQuality;
    for (const entry of editorViews.get().views.values()) {
      const asset = assets.find(entry.asset);
      if (asset === undefined) continue;
      const subject = peakSubjectOf(asset, quality);
      shown.set(keyOf(subject), subject);
    }
    for (const [key, handle] of held) {
      if (shown.has(key)) continue;
      handle.release();
      held.delete(key);
    }
    for (const [key, subject] of shown) {
      if (!held.has(key)) held.set(key, peaks.open(subject));
    }
  };
  follow();
  const stops = [
    editorViews.subscribe(follow),
    assets.subscribe(follow),
    audioSettings.subscribe(follow),
  ];
  return () => {
    for (const stop of stops) stop();
    for (const handle of held.values()) handle.release();
    held.clear();
  };
}
