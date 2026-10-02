/**
 * Whether a marker or a region may stand on its asset.
 *
 * Each of their positions is stated at a basis (ADR-0051), so each is checked
 * against the asset's timeline at that basis: a basis the chain does not have,
 * or a position past the timeline it names, is refused. A region's processing
 * is checked the same way. A layout conversion made after a region's
 * processing was placed would leave that processing naming channels by an old
 * layout, so processing that names channels must come after the asset's last
 * conversion, and a command converting a layout under it is refused.
 */

import { channelCount } from '../audio/channel-layout.js';
import type { Asset } from '../project/asset.js';
import type { Marker, Region } from '../project/timeline.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import { shapesOf, type EditShape } from './edit-shape.js';
import { isLevelEdit, type RegionOperation } from './operations.js';
import { rangeEditProblem, rangeProblem } from './operation-validation.js';

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`editing.${code}`, FailureKind.Rejected, summary));
}

/** The timeline at `basis`, or `undefined` where the chain has no such point. */
function shapeAt(shapes: readonly EditShape[], basis: number): EditShape | undefined {
  return Number.isInteger(basis) ? shapes[basis] : undefined;
}

/** Whether `operation` names channels, by a scope or as a change between them. */
export function namesChannels(operation: RegionOperation): boolean {
  return operation.channels !== undefined || !isLevelEdit(operation.edit);
}

/** The index of the asset's last layout conversion, or −1 where it has none. */
export function lastConversion(asset: Asset): number {
  return asset.edits.findLastIndex((operation) => operation.kind === 'convert-layout');
}

/** The marker, where it lies on its asset's timeline at its basis. */
export function validateMarker(asset: Asset, marker: Marker): DomainResult<Marker> {
  const shape = shapeAt(shapesOf(asset), marker.basis);
  if (shape === undefined)
    return refused('basis-unknown', 'The marker is placed on edits the asset does not have.');
  return Number.isSafeInteger(marker.position) &&
    marker.position >= 0 &&
    marker.position <= shape.length
    ? succeed(marker)
    : refused('marker-outside', 'The marker lies outside its asset’s audio.');
}

/** Why one of a region's processing operations does not stand, or `undefined`. */
function regionOperationProblem(
  asset: Asset,
  shapes: readonly EditShape[],
  operation: RegionOperation,
): string | undefined {
  const shape = shapeAt(shapes, operation.basis);
  if (shape === undefined)
    return 'The region’s processing is placed on edits the asset does not have.';
  if (namesChannels(operation) && operation.basis <= lastConversion(asset)) {
    return 'The region’s processing names channels the asset’s layout has since changed.';
  }
  return (
    rangeProblem(operation.range, shape.length) ??
    rangeEditProblem(operation.edit, operation.channels, channelCount(shape.layout))
  );
}

/** The region, where its boundaries, loop and processing lie on its asset. */
export function validateRegion(asset: Asset, region: Region): DomainResult<Region> {
  const shapes = shapesOf(asset);
  const shape = shapeAt(shapes, region.basis);
  if (shape === undefined)
    return refused('basis-unknown', 'The region is placed on edits the asset does not have.');
  const bounds = rangeProblem({ start: region.start, end: region.end }, shape.length);
  if (bounds !== undefined) return refused('region-outside', bounds);
  if (region.loop !== undefined) {
    const loop = region.loop;
    const loopShape = shapeAt(shapes, loop.basis);
    const problem =
      loopShape === undefined
        ? 'The loop is placed on edits the asset does not have.'
        : rangeProblem({ start: loop.start, end: loop.end }, loopShape.length);
    if (problem !== undefined) return refused('loop-outside', problem);
    if (
      !Number.isSafeInteger(loop.crossfadeLength) ||
      loop.crossfadeLength < 0 ||
      loop.crossfadeLength > loop.end - loop.start
    ) {
      return refused('loop-crossfade', 'A loop’s crossfade must fit within the loop.');
    }
  }
  const seen = new Set<string>();
  for (const operation of region.operations) {
    if (seen.has(operation.id))
      return refused('duplicate-operation', 'Two of the region’s edits share an identifier.');
    seen.add(operation.id);
    const problem = regionOperationProblem(asset, shapes, operation);
    if (problem !== undefined) return refused('region-operation-invalid', problem);
  }
  return succeed(region);
}
