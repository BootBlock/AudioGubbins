/**
 * Which edited sound of an asset a view's analyses draw: its revision, which
 * every edit changes, and the values a final render runs at, since a change of
 * either changes what is drawn. The peaks and the spectrogram of a revision are
 * kept under it, so neither is ever taken for another's (ADR-0043, ADR-0080).
 */

import type { QualityMode } from '@audiogubbins/domain';

import type { EditorAsset } from '../assets/editor-asset.js';

/** The revision of the sound of `asset` processed at `quality`. */
export function editedRevisionOf(asset: EditorAsset, quality: QualityMode): string {
  const { resampling, oversampling, spectralOverlap } = quality.settings;
  return `${asset.revision}.${resampling}-${String(oversampling)}-${String(spectralOverlap)}`;
}
