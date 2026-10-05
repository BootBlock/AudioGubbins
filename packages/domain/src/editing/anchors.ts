/**
 * Carrying a position through an asset's edits.
 *
 * Markers, region boundaries and a region's processing are stated at a
 * *basis*, the number of the asset's operations that existed when they were
 * placed, and resolved by carrying them through every operation after it
 * (ADR-0051). Nothing placed on an asset is rewritten by an edit, so an undo,
 * which withdraws the last operation, restores every position exactly.
 *
 * Each operation states how it carries a boundary:
 *
 * - a deletion closes over what it removed, so a position inside it moves to
 *   where the gap closed;
 * - an insertion pushes the positions after it on, and one exactly at it moves
 *   on with the content after it (`Affinity.After`, as a marker and a region's
 *   start do) or stays with the content before it (`Affinity.Before`, as a
 *   region's end does), so pasting at a region's edge never widens it or makes
 *   two regions overlap;
 * - a trim keeps its range and closes both ends;
 * - a reversal reflects the boundaries inside its range, each of which then
 *   lies between the same two frames as before;
 * - processing and a layout conversion carry every position unchanged.
 */

import type { Asset } from '../project/asset.js';
import { insertedLength, shapesOf, type EditShape } from './edit-shape.js';
import type { EditOperation } from './operations.js';

/** Which content a position at an insertion stays with. */
export const Affinity = { Before: 'before', After: 'after' } as const;

/** Which content a position at an insertion stays with. */
export type Affinity = (typeof Affinity)[keyof typeof Affinity];

/** A span between two boundaries, `start` at or before `end`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Where `position` lies after `operation`, which acts on a timeline of `shape`. */
export function carryPosition(
  operation: EditOperation,
  shape: EditShape,
  position: number,
  affinity: Affinity,
): number {
  switch (operation.kind) {
    case 'delete': {
      const { start, end } = operation.range;
      if (position <= start) return position;
      return position >= end ? position - (end - start) : start;
    }
    case 'trim': {
      const { start, end } = operation.range;
      return Math.min(Math.max(position, start), end) - start;
    }
    case 'insert': {
      const added = insertedLength(operation, shape.sampleRate);
      if (position < operation.at) return position;
      if (position > operation.at) return position + added;
      return affinity === Affinity.After ? position + added : position;
    }
    case 'reverse': {
      const { start, end } = operation.range;
      return position > start && position < end ? start + end - position : position;
    }
    case 'process':
    case 'convert-layout':
      return position;
  }
}

/**
 * Where a span lies after `operation`: its start carried with the content
 * after it and its end with the content before, and the two exchanged where a
 * reversal turned the span round.
 */
export function carrySpan(operation: EditOperation, shape: EditShape, span: Span): Span {
  const start = carryPosition(operation, shape, span.start, Affinity.After);
  const end = carryPosition(operation, shape, span.end, Affinity.Before);
  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * Resolves positions placed on one asset, measuring its chain once for all of
 * them. Each answer is `undefined` where the basis is not one of the asset's.
 */
export interface AnchorResolver {
  position(basis: number, position: number, affinity: Affinity): number | undefined;
  span(basis: number, span: Span): Span | undefined;
}

/** A resolver for the positions placed on `asset` as its chain stands. */
export function anchorResolver(asset: Asset): AnchorResolver {
  const shapes = shapesOf(asset);
  const valid = (basis: number): boolean =>
    Number.isInteger(basis) && basis >= 0 && basis <= asset.edits.length;
  const carry = <T>(
    basis: number,
    start: T,
    step: (operation: EditOperation, shape: EditShape, value: T) => T,
  ): T => {
    let carried = start;
    for (let index = basis; index < asset.edits.length; index += 1) {
      const operation = asset.edits[index];
      const shape = shapes[index];
      if (operation !== undefined && shape !== undefined) carried = step(operation, shape, carried);
    }
    return carried;
  };
  return {
    position: (basis, position, affinity) =>
      valid(basis)
        ? carry(basis, position, (operation, shape, value) =>
            carryPosition(operation, shape, value, affinity),
          )
        : undefined,
    span: (basis, span) => (valid(basis) ? carry(basis, span, carrySpan) : undefined),
  };
}
