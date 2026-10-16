/**
 * What a workflow finds already done (ADR-0105), so running one again plans
 * only what is not there: a fade already at an edge, a processor already in a
 * chain, a region already over a span, a loop already at the chosen points, a
 * policy field already at the value. Each is answered from the project as it
 * is, placed through the anchors the domain carries every position by.
 */

import {
  anchorResolver,
  placeRegion,
  type Asset,
  type ChainSlot,
  type FadeDirection,
  type LoopDefinition,
  type ProcessorInstance,
  type Project,
  type Region,
  type Span,
} from '@audiogubbins/domain';
import type {
  GameAssetGroup,
  OverridableField,
  PolicyField,
  PolicyOverrides,
  PolicyValues,
} from '@audiogubbins/game-audio';
import { canonicalJson, writePolicyValue } from '@audiogubbins/project-format';

/** A fade placed on its asset's edited timeline. */
interface PlacedFade {
  readonly direction: FadeDirection;
  readonly span: Span;
}

/** The fades of `region`'s own processing, placed on its asset's edited timeline. */
export function regionFades(asset: Asset, region: Region): readonly PlacedFade[] {
  const resolver = anchorResolver(asset);
  return region.operations.flatMap((operation) => {
    if (operation.edit.kind !== 'fade') return [];
    const span = resolver.span(operation.basis, operation.range);
    return span === undefined ? [] : [{ direction: operation.edit.direction, span }];
  });
}

/** The fades of `asset`'s own chain of edits, placed on its edited timeline. */
export function assetFades(asset: Asset): readonly PlacedFade[] {
  const resolver = anchorResolver(asset);
  return asset.edits.flatMap((operation, basis) => {
    if (operation.kind !== 'process' || operation.edit.kind !== 'fade') return [];
    const span = resolver.span(basis, operation.range);
    return span === undefined ? [] : [{ direction: operation.edit.direction, span }];
  });
}

/**
 * Whether `fades` hold one in `direction` at the edge `at` of `length`
 * frames, give or take one: a fade in starting at `at`, or a fade out ending
 * there.
 */
export function hasFadeAt(
  fades: readonly PlacedFade[],
  direction: FadeDirection,
  at: number,
  length: number,
): boolean {
  return fades.some((fade) => {
    const edge = direction === 'in' ? fade.span.start : fade.span.end;
    return (
      fade.direction === direction &&
      edge === at &&
      Math.abs(fade.span.end - fade.span.start - length) <= 1
    );
  });
}

/** Whether `slot` is a processor of `processor`'s type set to the same values. */
export function sameProcessor(slot: ChainSlot | undefined, processor: ProcessorInstance): boolean {
  if (slot?.kind !== 'processor' || slot.typeKey !== processor.typeKey) return false;
  if (slot.values.size !== processor.values.size) return false;
  for (const [parameter, value] of processor.values) {
    if (slot.values.get(parameter) !== value) return false;
  }
  return true;
}

/** Whether a region of `asset` already lies exactly over `span` of its edited timeline. */
export function regionOver(project: Project, asset: Asset, span: Span): boolean {
  const resolver = anchorResolver(asset);
  for (const region of project.regions.values()) {
    if (region.assetId !== asset.id) continue;
    const placed = placeRegion(resolver, region);
    if (placed?.start === span.start && placed.start + placed.length === span.end) return true;
  }
  return false;
}

/**
 * Whether `region`'s loop, placed, is `loop`: the same points, crossfade length
 * and shape, and the same rendering of its processing.
 */
export function loopIs(asset: Asset, region: Region, loop: LoopDefinition): boolean {
  const placed = placeRegion(anchorResolver(asset), region)?.loop;
  return (
    placed?.loopStart === loop.loopStart &&
    placed.loopEnd === loop.loopEnd &&
    placed.crossfadeLength === loop.crossfadeLength &&
    placed.crossfadeShape === loop.crossfadeShape &&
    placed.processingAcrossLoop === loop.processingAcrossLoop
  );
}

/** Two values of `field` compared as the project document writes them. */
function samePolicyValue<F extends PolicyField>(
  field: F,
  left: PolicyValues[F] | undefined,
  right: PolicyValues[F],
): boolean {
  return (
    left !== undefined &&
    canonicalJson(writePolicyValue(field, left)) === canonicalJson(writePolicyValue(field, right))
  );
}

/** Whether `group` itself sets `field` to `value`. */
export function groupSets<F extends PolicyField>(
  group: GameAssetGroup,
  field: F,
  value: PolicyValues[F],
): boolean {
  return samePolicyValue(field, group.policy[field], value);
}

/** Whether `overrides` set `field` to `value`. */
export function overrideSets<F extends OverridableField>(
  overrides: PolicyOverrides,
  field: F,
  value: PolicyValues[F],
): boolean {
  return samePolicyValue(field, overrides[field], value);
}
