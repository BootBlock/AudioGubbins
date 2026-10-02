/**
 * Writing what is placed on an asset, as `placement-reading.ts` reads it:
 * regions with their loops and processing, and markers (ADR-0051).
 */

import type { AnchoredLoop, Marker, Region } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import { presentMembers } from './document-writing.js';
import { writeRegionOperation } from './edit-writing.js';

/** Writes a region's loop. */
export function writeAnchoredLoop(loop: AnchoredLoop): JsonObject {
  return {
    basis: loop.basis,
    start: loop.start,
    end: loop.end,
    crossfadeLength: loop.crossfadeLength,
  };
}

/** Writes one region, its processing in the order it was made. */
export function writeRegion(region: Region): JsonObject {
  return presentMembers({
    id: region.id,
    assetId: region.assetId,
    displayName: region.displayName,
    basis: region.basis,
    start: region.start,
    end: region.end,
    loop: region.loop === undefined ? undefined : writeAnchoredLoop(region.loop),
    tags: [...region.tags],
    operations: region.operations.map(writeRegionOperation),
  });
}

/** Writes one marker. */
export function writeMarker(marker: Marker): JsonObject {
  return presentMembers({
    id: marker.id,
    assetId: marker.assetId,
    displayName: marker.displayName,
    basis: marker.basis,
    position: marker.position,
    paletteKey: marker.paletteKey,
  });
}
