/**
 * Playback following the asset it plays as the project changes it, and as the
 * person switches between its processed and original sound (REQ-AUDIO-019).
 *
 * The project changes only through its commands, and the catalogue of assets
 * follows the project; this hands the transport each new state of the asset
 * it holds, so a parameter a command changed is heard as it plays, and
 * anything else is heard from where it plays or at the next Play
 * (`PlaybackControl.follow`). A switch between the processed and the original
 * sound is followed the same way, so it is heard from where the listener is.
 * The interface never writes what playback hears.
 */

import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { HearingStore } from '../state/hearing-store.js';
import { assetProgramme } from './asset-playback.js';
import type { PlaybackControl } from './playback-control.js';

/** Hands `playback` each new sound of the asset it holds, until the answer is called. */
export function followPlayingAsset(
  assets: Pick<AssetCatalogue, 'subscribe' | 'find'>,
  hearing: Pick<HearingStore, 'get' | 'subscribe'>,
  playback: Pick<PlaybackControl, 'programme' | 'follow'>,
): () => void {
  const follow = (): void => {
    const key = playback.programme();
    const asset = key === undefined ? undefined : assets.find(key);
    if (asset !== undefined) playback.follow(assetProgramme(asset, hearing.get()));
  };
  const stopAssets = assets.subscribe(follow);
  const stopHearing = hearing.subscribe(follow);
  return () => {
    stopAssets();
    stopHearing();
  };
}
