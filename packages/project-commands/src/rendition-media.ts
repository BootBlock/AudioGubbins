/**
 * What an asset decoded from a compressed file may be kept as (ADR-0090): its
 * media is the rendition, which only the media store keeps; the compressed
 * file itself is linked or copied apart, in its provenance.
 */

import { refusal, type RefusedOutcome } from '@audiogubbins/commands';
import type { Asset } from '@audiogubbins/domain';
import type { AssetSource, MediaSource } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

/**
 * The refusal of `media` for an asset of `source`, where it is a rendition and
 * `media` would link it to a file, or nothing where the media may be taken.
 */
export function renditionMediaRefusal(
  asset: Asset,
  source: AssetSource,
  media: MediaSource,
): RefusedOutcome | undefined {
  if (source.provenance?.rendition === undefined || media.kind === 'managed') return undefined;
  return refusal(
    'source.rendition-kept-in-store',
    `${quoted(asset.displayName)} is audio decoded from a compressed file, which is kept in the project and cannot be linked to a file.`,
  );
}
