/**
 * What splitting makes (ADR-0051).
 *
 * A region split inside it becomes two regions that meet at the split: the
 * first keeps its identity, the second is new and named after it, and each
 * keeps the processing that covers its part, in the order it was made, and the
 * loop where the loop lies wholly inside it. Processing over the split is kept
 * by both, whole, so each part sounds as it did: a fade's shape is measured
 * over its whole range wherever it is cut (`regionPlan`). A split where no
 * region is makes two regions over the whole of the asset.
 *
 * Every boundary made here is restated at the asset's chain as it stands, so it
 * stays on the content it was put on through every later edit.
 */

import type { IdGenerator } from '../identity/id-generator.js';
import type { Asset } from '../project/asset.js';
import type { Region } from '../project/timeline.js';
import { ZERO_SAMPLES, derivedSampleCount, type SampleCount } from '../time/sample-time.js';
import { anchorResolver, type AnchorResolver, type Span } from './anchors.js';
import { shapesOf } from './edit-shape.js';

/** The name the second part of a split is given, after the first. */
function secondPartName(name: string): string {
  return `${name} (2)`;
}

/**
 * `region` with its boundaries at `span`, on its asset's edited timeline,
 * stated at the asset's chain as it stands: how every change of a region's
 * boundaries is kept.
 */
export function restateRegion(region: Region, asset: Asset, span: Span): Region {
  return {
    ...region,
    basis: asset.edits.length,
    start: derivedSampleCount(span.start),
    end: derivedSampleCount(span.end),
  };
}

/**
 * The two regions `region` becomes split at `at`, a position on its asset's
 * edited timeline, or `undefined` where `at` is not inside it. New identities,
 * the second part's and its processing's, come from `ids`.
 */
export function splitRegion(
  asset: Asset,
  region: Region,
  at: SampleCount,
  ids: IdGenerator,
  resolver: AnchorResolver = anchorResolver(asset),
): readonly [Region, Region] | undefined {
  const span = resolver.span(region.basis, { start: region.start, end: region.end });
  if (span === undefined || at <= span.start || at >= span.end) return undefined;
  const loop =
    region.loop === undefined
      ? undefined
      : resolver.span(region.loop.basis, { start: region.loop.start, end: region.loop.end });
  const part = (bounds: Span): Region => {
    const { loop: _loop, ...unlooped } = region;
    const keepsLoop = loop !== undefined && loop.start >= bounds.start && loop.end <= bounds.end;
    const operations = region.operations.filter((operation) => {
      const range = resolver.span(operation.basis, operation.range);
      return range !== undefined && range.start < bounds.end && range.end > bounds.start;
    });
    return restateRegion({ ...(keepsLoop ? region : unlooped), operations }, asset, bounds);
  };
  const first = part({ start: span.start, end: at });
  const after = part({ start: at, end: span.end });
  const second: Region = {
    ...after,
    id: ids.next<'RegionId'>(),
    displayName: secondPartName(region.displayName),
    operations: after.operations.map((operation) => ({
      ...operation,
      id: ids.next<'EditOperationId'>(),
    })),
  };
  return [first, second];
}

/**
 * The two regions a split at `at` makes of the whole of `asset`, named `name`
 * and after it, or `undefined` where `at` is not inside the asset's audio.
 */
export function splitWholeAsset(
  asset: Asset,
  at: SampleCount,
  name: string,
  ids: IdGenerator,
): readonly [Region, Region] | undefined {
  const length = shapesOf(asset).at(-1)?.length ?? asset.length;
  if (at <= 0 || at >= length) return undefined;
  const made = (displayName: string, start: SampleCount, end: SampleCount): Region => ({
    id: ids.next<'RegionId'>(),
    assetId: asset.id,
    displayName,
    basis: asset.edits.length,
    start,
    end,
    tags: [],
    operations: [],
  });
  return [made(name, ZERO_SAMPLES, at), made(secondPartName(name), at, derivedSampleCount(length))];
}
