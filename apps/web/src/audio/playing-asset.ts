/**
 * Playback following the asset it plays as the project changes it
 * (REQ-AUDIO-019).
 *
 * The project changes only through its commands, and the catalogue of assets
 * follows the project; this hands the transport each new state of the asset
 * it holds, so a parameter a command changed is heard as it plays, and
 * anything else is heard from where it plays or at the next Play
 * (`PlaybackControl.follow`). The interface never writes what playback hears.
 */

import type { AssetCatalogue } from '../state/asset-catalogue.js';
import { assetProgramme } from './asset-playback.js';
import type { PlaybackControl } from './playback-control.js';

/** Hands `playback` each new state of the asset it holds, until the answer is called. */
export function followPlayingAsset(
  assets: Pick<AssetCatalogue, 'subscribe' | 'find'>,
  playback: Pick<PlaybackControl, 'programme' | 'follow'>,
): () => void {
  return assets.subscribe(() => {
    const key = playback.programme();
    const asset = key === undefined ? undefined : assets.find(key);
    if (asset !== undefined) playback.follow(assetProgramme(asset));
  });
}
