/**
 * Where markers and regions lie on the timeline a view shows, and what a
 * region sounds like.
 *
 * A marker or a region is kept anchored to its asset's content (ADR-0051);
 * a view draws it placed, at the position its anchors resolve to now. A
 * region's view shows the region's own timeline, from its start, so what is
 * placed on the asset is shifted and cut to the region there.
 */

import type { Asset } from '../project/asset.js';
import type { Marker, PlacedMarker, PlacedRegion, Region } from '../project/timeline.js';
import { mapResult, type DomainResult } from '../result.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { Affinity, anchorResolver, type AnchorResolver, type Span } from './anchors.js';
import { assetPlan, unrackedAssetPlan, withRack, type PlanContext } from './plan-building.js';
import type { EditPlan } from './plan.js';
import { sliceSegments } from './segment-list.js';
import { pruneStreams } from './stream-tables.js';

/** Markers in position order, and in identifier order at one position. */
function byPosition(left: PlacedMarker, right: PlacedMarker): number {
  return left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/** The asset's markers among `markers`, placed on its edited timeline. */
export function placeMarkers(
  asset: Asset,
  markers: Iterable<Marker>,
  resolver = anchorResolver(asset),
): readonly PlacedMarker[] {
  const placed: PlacedMarker[] = [];
  for (const marker of markers) {
    if (marker.assetId !== asset.id) continue;
    const position = resolver.position(marker.basis, marker.position, Affinity.After);
    if (position === undefined) continue;
    placed.push({
      id: marker.id,
      displayName: marker.displayName,
      position: derivedSampleCount(position),
      ...(marker.paletteKey === undefined ? {} : { paletteKey: marker.paletteKey }),
    });
  }
  return placed.sort(byPosition);
}

/** Where a region's boundaries lie on its asset's edited timeline. */
function regionSpan(resolver: AnchorResolver, region: Region): Span | undefined {
  return resolver.span(region.basis, { start: region.start, end: region.end });
}

/** A region placed on its asset's edited timeline, its loop cut to it. */
export function placeRegion(resolver: AnchorResolver, region: Region): PlacedRegion | undefined {
  const span = regionSpan(resolver, region);
  if (span === undefined) return undefined;
  const loopSpan =
    region.loop === undefined
      ? undefined
      : resolver.span(region.loop.basis, { start: region.loop.start, end: region.loop.end });
  const loopStart = Math.max(loopSpan?.start ?? 0, span.start) - span.start;
  const loopEnd = Math.min(loopSpan?.end ?? 0, span.end) - span.start;
  const loop =
    region.loop === undefined || loopEnd <= loopStart
      ? {}
      : {
          loop: {
            loopStart: derivedSampleCount(loopStart),
            loopEnd: derivedSampleCount(loopEnd),
            crossfadeLength: derivedSampleCount(
              Math.min(region.loop.crossfadeLength, loopEnd - loopStart),
            ),
          },
        };
  return {
    id: region.id,
    displayName: region.displayName,
    start: derivedSampleCount(span.start),
    length: derivedSampleCount(span.end - span.start),
    tags: region.tags,
    ...loop,
  };
}

/** The asset's regions among `regions`, placed, in start order. */
export function placeRegions(
  asset: Asset,
  regions: Iterable<Region>,
  resolver = anchorResolver(asset),
): readonly PlacedRegion[] {
  const placed: PlacedRegion[] = [];
  for (const region of regions) {
    if (region.assetId !== asset.id) continue;
    const one = placeRegion(resolver, region);
    if (one !== undefined) placed.push(one);
  }
  return placed.sort((left, right) => left.start - right.start || left.length - right.length);
}

/** Markers placed on the asset, as they lie in a region placed at `region`: shifted to its start. */
export function markersInRegion(
  markers: readonly PlacedMarker[],
  region: PlacedRegion,
): readonly PlacedMarker[] {
  return markers
    .filter(
      (marker) =>
        marker.position >= region.start && marker.position <= region.start + region.length,
    )
    .map((marker) => ({ ...marker, position: derivedSampleCount(marker.position - region.start) }));
}

/**
 * What a region sounds like (ADR-0060): its asset's audio through the
 * region's own processing, each operation folded in on the timeline of its
 * basis (`plan-building.ts`), so it stays on the content it was put on and a
 * fade begun outside the region keeps its ramp inside it; then the asset's
 * rack over the whole asset; then the region's span of that, so its rack
 * reads exactly that span of its asset's processed audio; then its rack.
 */
export function regionPlan(
  asset: Asset,
  region: Region,
  context: PlanContext,
  resolver = anchorResolver(asset),
): DomainResult<EditPlan> {
  const whole = assetPlan(asset, context, region.operations);
  if (!whole.ok) return whole;
  return mapResult(
    withRack(regionSlice(whole.value, resolver, region), region.rack, context),
    pruneStreams,
  );
}

/**
 * What a region sounds like before its asset's rack and its own: its asset's
 * audio through the region's own processing, and the region's span of that.
 * What a rack edit over a range of the region reads, since a rack edit is
 * folded in among its asset's chain, before either rack (ADR-0060's order).
 */
export function unrackedRegionPlan(
  asset: Asset,
  region: Region,
  context: PlanContext,
  resolver = anchorResolver(asset),
): DomainResult<EditPlan> {
  return mapResult(unrackedAssetPlan(asset, context, region.operations), (whole) =>
    pruneStreams(regionSlice(whole, resolver, region)),
  );
}

/** `plan`'s first stream cut to the region's span of its asset. */
function regionSlice(plan: EditPlan, resolver: AnchorResolver, region: Region): EditPlan {
  const [stream, ...others] = plan.streams;
  const span = regionSpan(resolver, region) ?? { start: 0, end: 0 };
  const segments = sliceSegments(stream.segments, span.start, span.end);
  return { streams: [{ ...stream, segments }, ...others] };
}
