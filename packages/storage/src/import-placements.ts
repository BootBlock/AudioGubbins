/**
 * A file's loops and cue points made into the regions and markers of its new
 * asset (ADR-0090, ADR-0093, REQ-GAME-121).
 *
 * The file states its positions in its own frames. A file read where it lies
 * is the asset, frame for frame; a rendition is the stream decoded at its own
 * rate, never resampled, from its first frame after the priming the decoder
 * trimmed, so a position of the file is the asset's frame less the frames the
 * stream's description says lie before that first frame. Each loop becomes a
 * region over the whole asset, so the sound plays from its start into the
 * loop and on past it, with the loop at the file's span; each cue point
 * becomes a marker. A loop or a cue that falls outside the asset, or a loop
 * of no length, describes no frame of it and is left out, and the import says
 * how many were. The project's loop is forward and endless: a file's play
 * count and direction are kept in the asset's provenance with the rest of its
 * metadata.
 */

import {
  DEFAULT_LOOP_CROSSFADE_SHAPE,
  derivedSampleCount,
  type Asset,
  type IdGenerator,
  type Marker,
  type Region,
} from '@audiogubbins/domain';
import type { CuePoint, MetadataLoop } from '@audiogubbins/codecs';

/** The longest name a region or a marker takes, which the project document holds. */
const LONGEST_NAME = 1_024;

/** What a file's loops and cues place on its asset, and what of them could not be placed. */
export interface ImportPlacements {
  readonly regions: readonly Region[];
  readonly markers: readonly Marker[];
  readonly skipped: { readonly loops: number; readonly cues: number };
}

/** A file's loops and cue points, in the file's frames. */
export interface FilePositions {
  readonly loops?: readonly MetadataLoop[] | undefined;
  readonly cues?: readonly CuePoint[] | undefined;
}

/**
 * The regions and markers `positions` place on `asset`, whose first frame is
 * the file's frame `leadingFrames` (see the module comment).
 */
export function importPlacements(
  asset: Asset,
  positions: FilePositions,
  leadingFrames: number,
  ids: IdGenerator,
): ImportPlacements {
  const basis = asset.edits.length;
  const loops = positions.loops ?? [];
  const cues = positions.cues ?? [];
  const regions: Region[] = [];
  for (const [index, loop] of loops.entries()) {
    const start = loop.start - leadingFrames;
    const end = start + loop.length;
    if (loop.length === 0 || start < 0 || end > asset.length) continue;
    regions.push({
      id: ids.next<'RegionId'>(),
      assetId: asset.id,
      displayName: nameOf(loop.name, loops.length === 1 ? 'Loop' : `Loop ${String(index + 1)}`),
      basis,
      start: derivedSampleCount(0),
      end: asset.length,
      loop: {
        basis,
        start: derivedSampleCount(start),
        end: derivedSampleCount(end),
        crossfadeLength: derivedSampleCount(0),
        crossfadeShape: DEFAULT_LOOP_CROSSFADE_SHAPE,
      },
      tags: [],
      operations: [],
    });
  }
  const markers: Marker[] = [];
  for (const [index, cue] of cues.entries()) {
    const position = cue.position - leadingFrames;
    if (position < 0 || position > asset.length) continue;
    markers.push({
      id: ids.next<'MarkerId'>(),
      assetId: asset.id,
      displayName: nameOf(cue.name, `Cue ${String(index + 1)}`),
      basis,
      position: derivedSampleCount(position),
    });
  }
  return {
    regions,
    markers,
    skipped: { loops: loops.length - regions.length, cues: cues.length - markers.length },
  };
}

/** The file's name for a point, trimmed, where it gives one a project can hold, else `fallback`. */
function nameOf(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' || trimmed.length > LONGEST_NAME ? fallback : trimmed;
}
