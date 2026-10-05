/**
 * Where markers and regions lie on the timeline a view shows, and what a
 * region sounds like.
 *
 * A marker or a region is kept anchored to its asset's content (ADR-0051);
 * a view draws it placed, at the position its anchors resolve to now. A
 * region's view shows the region's own timeline, from its start, so what is
 * placed on the asset is shifted and cut to the region there.
 */

import { channelCount } from '../audio/channel-layout.js';
import type { Asset } from '../project/asset.js';
import type { Marker, PlacedMarker, PlacedRegion, Region } from '../project/timeline.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { Affinity, anchorResolver, type AnchorResolver, type Span } from './anchors.js';
import { assetPlan } from './plan-building.js';
import type { EditPlan } from './plan.js';
import { rangeEditStage } from './range-stages.js';
import { changeRange, sliceSegments } from './segment-list.js';
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
 * What a region sounds like: its asset's edited audio between its boundaries,
 * through the region's own processing, each operation's range carried from
 * its basis and cut to the region.
 */
export function regionPlan(
  asset: Asset,
  region: Region,
  resolver = anchorResolver(asset),
): EditPlan {
  const plan = assetPlan(asset);
  const [stream, ...others] = plan.streams;
  const span = regionSpan(resolver, region) ?? { start: 0, end: 0 };
  let segments = sliceSegments(stream.segments, span.start, span.end);
  const count = channelCount(stream.layout);
  for (const operation of region.operations) {
    const range = resolver.span(operation.basis, operation.range);
    if (range === undefined) continue;
    const from = Math.max(range.start, span.start) - span.start;
    const to = Math.min(range.end, span.end) - span.start;
    if (from >= to) continue;
    segments = changeRange(
      segments,
      from,
      to,
      rangeEditStage(
        operation.edit,
        { start: range.start - span.start, end: range.end - span.start },
        operation.channels,
        count,
      ),
    );
  }
  return pruneStreams({ streams: [{ ...stream, segments }, ...others] });
}
