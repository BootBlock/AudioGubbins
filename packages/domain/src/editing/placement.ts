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
import type {
  LoopDefinition,
  Marker,
  PlacedMarker,
  PlacedRegion,
  Region,
} from '../project/timeline.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { flatMapResult, mapResult, succeed, type DomainResult } from '../result.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { Affinity, anchorResolver, type AnchorResolver, type Span } from './anchors.js';
import { assetPlan, bypassedAssetPlan, unrackedAssetPlan, withRack } from './plan-building.js';
import type { PlanContext } from './plan-context.js';
import type { EditPlan } from './plan.js';
import { withLoopCrossfade } from './loop-crossfade.js';
import { loopRendering, warmUpCycles } from './loop-rendering.js';
import { introSpliceLength, joinedAtLoopStart, warmUpInput } from './loop-wrapping.js';
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

/**
 * `region`'s loop placed in a region placed at `span`: cut to the region, or
 * `undefined` where none of it is left. Its crossfade is cut to fit, since an
 * edit after it was set may have moved the loop's start nearer the region's,
 * whose frames the crossfade reads, or its end nearer its start; where it is
 * cut, the placed loop says what it was.
 */
function placeLoop(
  resolver: AnchorResolver,
  region: Region,
  span: Span,
): { readonly loop?: LoopDefinition } {
  const kept = region.loop;
  if (kept === undefined) return {};
  const loopSpan = resolver.span(kept.basis, { start: kept.start, end: kept.end });
  const loopStart = Math.max(loopSpan?.start ?? 0, span.start) - span.start;
  const loopEnd = Math.min(loopSpan?.end ?? 0, span.end) - span.start;
  if (loopEnd <= loopStart) return {};
  const fits = Math.min(kept.crossfadeLength, loopStart, loopEnd - loopStart);
  return {
    loop: {
      loopStart: derivedSampleCount(loopStart),
      loopEnd: derivedSampleCount(loopEnd),
      crossfadeLength: derivedSampleCount(fits),
      crossfadeShape: kept.crossfadeShape,
      processingAcrossLoop: kept.processingAcrossLoop,
      ...(fits < kept.crossfadeLength ? { crossfadeClampedFrom: kept.crossfadeLength } : {}),
    },
  };
}

/** A region placed on its asset's edited timeline, its loop cut to it. */
export function placeRegion(resolver: AnchorResolver, region: Region): PlacedRegion | undefined {
  const span = regionSpan(resolver, region);
  if (span === undefined) return undefined;
  return {
    id: region.id,
    displayName: region.displayName,
    start: derivedSampleCount(span.start),
    length: derivedSampleCount(span.end - span.start),
    tags: region.tags,
    ...placeLoop(resolver, region, span),
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

/** How a region's plan is made. */
export interface RegionPlanOptions {
  /**
   * Whether the plan holds the loop's crossfade, as the region is heard: true
   * unless asked otherwise. Without it is how a search for loop points reads
   * the region, since the crossfade belongs to the points being moved. The
   * loop's processing is rendered as the loop chooses either way (ADR-0107):
   * the crossfade reads what that rendering made.
   */
  readonly loopCrossfade?: boolean;
}

/**
 * What a region sounds like (ADR-0060, ADR-0103, ADR-0107): its asset's audio
 * through the region's own processing, each operation folded in on the
 * timeline of its basis (`plan-building.ts`), so it stays on the content it
 * was put on and a fade begun outside the region keeps its ramp inside it;
 * then the asset's rack over the whole asset; then the region's span of that,
 * so its rack reads exactly that span of its asset's processed audio; then its
 * rack. Where its loop renders wrapped (`loopRendering`), the racks also run
 * over a warm-up of the loop's body, and the region is joined from both runs
 * at the loop's start (`loop-wrapping.ts`). Then its loop's crossfade, over
 * what the racks made (`loop-crossfade.ts`).
 */
export function regionPlan(
  asset: Asset,
  region: Region,
  context: PlanContext,
  resolver = anchorResolver(asset),
  options: RegionPlanOptions = {},
): DomainResult<EditPlan> {
  const placed = placeRegion(resolver, region);
  const loop = placed?.loop;
  const rendering = loopRendering(asset, region, context);
  const sound =
    rendering?.kind === 'wrapped' && placed !== undefined && loop !== undefined
      ? wrappedRegionPlan(asset, region, context, resolver, {
          span: { start: placed.start, end: placed.start + placed.length },
          loop,
          racks: rendering.racks,
        })
      : fromStartRegionPlan(asset, region, context, resolver);
  return mapResult(sound, (plan) =>
    options.loopCrossfade === false || loop === undefined ? plan : withLoopCrossfade(plan, loop),
  );
}

/** A region's sound before its loop's crossfade, its racks run from its start (ADR-0060). */
function fromStartRegionPlan(
  asset: Asset,
  region: Region,
  context: PlanContext,
  resolver: AnchorResolver,
): DomainResult<EditPlan> {
  const whole = assetPlan(asset, context, region.operations);
  if (!whole.ok) return whole;
  return mapResult(
    withRack(regionSlice(whole.value, resolver, region), region.rack, context),
    pruneStreams,
  );
}

/**
 * A region's sound before its loop's crossfade, its racks wrapped across its
 * placed `loop` (ADR-0107): run from the region's start for its intro, and
 * over a warm-up of the loop's body, enough cycles to cover the lead-in of
 * `racks`, for the loop and what follows it.
 */
function wrappedRegionPlan(
  asset: Asset,
  region: Region,
  context: PlanContext,
  resolver: AnchorResolver,
  wrapping: {
    readonly span: Span;
    readonly loop: LoopDefinition;
    readonly racks: readonly EffectChain[];
  },
): DomainResult<EditPlan> {
  const edited = unrackedAssetPlan(asset, context, region.operations);
  if (!edited.ok) return edited;
  const { span, loop, racks } = wrapping;
  const { sampleRate } = edited.value.streams[0];
  const cycles = warmUpCycles(
    racks,
    context.catalogue,
    sampleRate,
    loop.loopEnd - loop.loopStart,
    introSpliceLength(loop, sampleRate),
  );
  // The asset's rack over what it is given, then the region's over `cut` of that.
  const racked = (plan: EditPlan, cut: (whole: EditPlan) => EditPlan) =>
    flatMapResult(withRack(plan, asset.rack, context), (whole) =>
      withRack(cut(whole), region.rack, context),
    );
  const ordinary = racked(edited.value, (whole) => regionSlice(whole, resolver, region));
  if (!ordinary.ok) return ordinary;
  const wrapped = racked(warmUpInput(edited.value, span, loop, cycles), (whole) => whole);
  if (!wrapped.ok) return wrapped;
  const shared = edited.value.streams.length - 1;
  return succeed(
    pruneStreams(joinedAtLoopStart(ordinary.value, wrapped.value, shared, loop, cycles)),
  );
}

/** `plan`, the region's sound, with its loop's crossfade, where it has one, placed. */
function looped(plan: EditPlan, resolver: AnchorResolver, region: Region): EditPlan {
  const loop = placeRegion(resolver, region)?.loop;
  return loop === undefined ? plan : withLoopCrossfade(plan, loop);
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

/**
 * What a region sounds like with every chain it runs bypassed: its asset's
 * audio through the region's own processing but its rack edits, and the
 * region's span of that, with neither rack run, and its loop's crossfade,
 * which is no chain. The original sound beside the processed one, for
 * comparing the two (REQ-AUDIO-019), so the two differ only by the chains.
 */
export function bypassedRegionPlan(
  asset: Asset,
  region: Region,
  context: PlanContext,
  resolver = anchorResolver(asset),
): DomainResult<EditPlan> {
  return mapResult(bypassedAssetPlan(asset, context, region.operations), (whole) =>
    looped(pruneStreams(regionSlice(whole, resolver, region)), resolver, region),
  );
}

/** `plan`'s first stream cut to the region's span of its asset. */
function regionSlice(plan: EditPlan, resolver: AnchorResolver, region: Region): EditPlan {
  const [stream, ...others] = plan.streams;
  const span = regionSpan(resolver, region) ?? { start: 0, end: 0 };
  const segments = sliceSegments(stream.segments, span.start, span.end);
  return { streams: [{ ...stream, segments }, ...others] };
}
