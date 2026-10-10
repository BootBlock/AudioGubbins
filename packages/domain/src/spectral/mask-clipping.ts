/**
 * A spectral mask kept within its asset when the asset's content changes
 * (ADR-0042, ADR-0081): what reconciling a selection does to its spectral
 * facet.
 *
 * A rectangle's range is clipped; a polygon is cut at the asset's ends, each
 * cut edge ending where it crosses one, at a whole position, so its outline
 * inside is kept exactly; a stroke keeps the points inside. A shape left with
 * nothing is dropped, and a mask left with nothing that adds is no mask.
 */

import { derivedSampleCount } from '../time/sample-time.js';
import {
  MaskEffect,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
} from './spectral-mask.js';

/** The point where the edge from `a` to `b` crosses `position`, which lies between them. */
function crossing(a: SpectralPoint, b: SpectralPoint, position: number): SpectralPoint {
  return {
    position: derivedSampleCount(position),
    frequency:
      a.frequency +
      ((position - a.position) * (b.frequency - a.frequency)) / (b.position - a.position),
  };
}

/** `points`, a closed outline, cut to the side of `edge` that `inside` keeps. */
function cutOutline(
  points: readonly SpectralPoint[],
  edge: number,
  inside: (position: number) => boolean,
): SpectralPoint[] {
  const kept: SpectralPoint[] = [];
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % count];
    if (current === undefined || next === undefined) continue;
    const currentIn = inside(current.position);
    const nextIn = inside(next.position);
    if (currentIn) kept.push(current);
    if (currentIn !== nextIn) kept.push(crossing(current, next, edge));
  }
  return kept;
}

/** `shape` within `[0, length]`, or `undefined` where nothing of it is left. */
function clippedShape(shape: SpectralShape, length: number): SpectralShape | undefined {
  switch (shape.kind) {
    case 'rectangle': {
      const start = Math.max(0, shape.range.start);
      const end = Math.min(length, shape.range.end);
      if (start >= end) return undefined;
      return start === shape.range.start && end === shape.range.end
        ? shape
        : { ...shape, range: { start: derivedSampleCount(start), end: derivedSampleCount(end) } };
    }
    case 'polygon': {
      if (shape.points.every((point) => point.position >= 0 && point.position <= length)) {
        return shape;
      }
      const cut = cutOutline(
        cutOutline(shape.points, 0, (position) => position >= 0),
        length,
        (position) => position <= length,
      );
      const [a, b, c, ...rest] = cut;
      return a === undefined || b === undefined || c === undefined
        ? undefined
        : { ...shape, points: [a, b, c, ...rest] };
    }
    case 'stroke': {
      const kept = shape.points.filter((point) => point.position >= 0 && point.position <= length);
      if (kept.length === shape.points.length) return shape;
      const [first, ...rest] = kept;
      return first === undefined ? undefined : { ...shape, points: [first, ...rest] };
    }
  }
}

/** `mask` within a timeline of `length`, or `undefined` where nothing that adds is left. */
export function clippedMask(mask: SpectralMask, length: number): SpectralMask | undefined {
  const shapes = mask.shapes.flatMap((shape) => {
    const clipped = clippedShape(shape, length);
    return clipped === undefined ? [] : [clipped];
  });
  if (!shapes.some((shape) => shape.effect === MaskEffect.Add)) return undefined;
  const [first, ...rest] = shapes;
  if (first === undefined) return undefined;
  return shapes.length === mask.shapes.length &&
    shapes.every((shape, i) => shape === mask.shapes[i])
    ? mask
    : { feather: mask.feather, shapes: [first, ...rest] };
}
