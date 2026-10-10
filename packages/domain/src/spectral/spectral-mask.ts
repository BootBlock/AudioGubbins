/**
 * A spectral mask: an area of time and frequency, as values (ADR-0081).
 *
 * A mask is what a spectral selection holds and what a spectral edit acts on:
 * a list of shapes, each adding to the mask or taking from it, and a feather
 * that softens the edges of its rectangles and polygons. A position is a
 * sample boundary, as every position on the timeline is (ADR-0041), and a
 * frequency is in hertz; a selection's mask is stated in its asset's
 * positions, and an edit's relative to the start of the range it processes.
 *
 * How much of a point a mask covers is stated once, in `mask-weight.ts`, and
 * every consumer reads it there: the engine that realises an edit, the view
 * that draws a selection, and the commands that measure one.
 */

import { MAXIMUM_SAMPLE_RATE, derivedSampleCount, type SampleCount } from '../time/sample-time.js';

/** A band of frequencies in hertz, `low` below `high`. */
export interface FrequencyBand {
  readonly low: number;
  readonly high: number;
}

/** The highest frequency a mask may name: half the highest rate an asset may have. */
export const HIGHEST_MASK_FREQUENCY = MAXIMUM_SAMPLE_RATE / 2;

/** A point of time and frequency: a boundary, and hertz. */
export interface SpectralPoint {
  readonly position: SampleCount;
  readonly frequency: number;
}

/**
 * The half-widths of a brush at one point of its stroke: samples either side
 * in time, and hertz either side in frequency. A brush drawn on a
 * logarithmic axis keeps its drawn shape because each point carries its own.
 */
export interface BrushRadius {
  readonly time: number;
  readonly frequency: number;
}

/** A point of a brush stroke, with the strength the brush had there and its radius. */
export interface StrokePoint extends SpectralPoint {
  /** From just above 0 to 1: a pen's pressure, or the fixed strength (`ADR-0082`). */
  readonly strength: number;
  readonly radius: BrushRadius;
}

/** Whether a shape adds to a mask or takes from it. */
export const MaskEffect = { Add: 'add', Subtract: 'subtract' } as const;

/** Whether a shape adds to a mask or takes from it. */
export type MaskEffect = (typeof MaskEffect)[keyof typeof MaskEffect];

/**
 * One shape of a mask.
 *
 * - `rectangle`: the range and the band, edges included.
 * - `polygon`: the area a lasso's points enclose, the last joined back to the
 *   first, by the even-odd rule.
 * - `stroke`: a brush's path, each point joined to the next. A point of the
 *   path weighs its strength out to `hardness` of its radius, then falls to
 *   nothing at the radius, so a stroke is softened by its own hardness rather
 *   than by the mask's feather.
 */
export type SpectralShape =
  | {
      readonly kind: 'rectangle';
      readonly effect: MaskEffect;
      readonly range: { readonly start: SampleCount; readonly end: SampleCount };
      readonly band: FrequencyBand;
    }
  | {
      readonly kind: 'polygon';
      readonly effect: MaskEffect;
      readonly points: readonly [SpectralPoint, SpectralPoint, SpectralPoint, ...SpectralPoint[]];
    }
  | {
      readonly kind: 'stroke';
      readonly effect: MaskEffect;
      /** From 0, softest, to just below 1, hardest. */
      readonly hardness: number;
      readonly points: readonly [StrokePoint, ...StrokePoint[]];
    };

/**
 * How far past its edges a rectangle or a polygon fades out: samples in time
 * and hertz in frequency, both zero, a hard edge, or both above zero.
 */
export interface SpectralFeather {
  readonly time: number;
  readonly frequency: number;
}

/** No feather: every rectangle and polygon has a hard edge. */
export const NO_FEATHER: SpectralFeather = { time: 0, frequency: 0 };

/** An area of time and frequency: shapes adding to it or taking from it, and a feather. */
export interface SpectralMask {
  readonly shapes: readonly [SpectralShape, ...SpectralShape[]];
  readonly feather: SpectralFeather;
}

/** A span of positions and a band: where a mask, or part of one, lies. */
export interface SpectralBounds {
  readonly start: number;
  readonly end: number;
  readonly low: number;
  readonly high: number;
}

/** The bounds of a shape's own outline, before any feather or radius. */
export function shapeOutline(shape: SpectralShape): SpectralBounds {
  if (shape.kind === 'rectangle') {
    return {
      start: shape.range.start,
      end: shape.range.end,
      low: shape.band.low,
      high: shape.band.high,
    };
  }
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const point of shape.points) {
    start = Math.min(start, point.position);
    end = Math.max(end, point.position);
    low = Math.min(low, point.frequency);
    high = Math.max(high, point.frequency);
  }
  return { start, end, low, high };
}

/**
 * The bounds outside which a shape weighs nothing: its outline widened by the
 * mask's feather, or, for a stroke, by each point's radius.
 */
export function shapeSupport(shape: SpectralShape, feather: SpectralFeather): SpectralBounds {
  if (shape.kind !== 'stroke') {
    const outline = shapeOutline(shape);
    return {
      start: outline.start - feather.time,
      end: outline.end + feather.time,
      low: outline.low - feather.frequency,
      high: outline.high + feather.frequency,
    };
  }
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const point of shape.points) {
    start = Math.min(start, point.position - point.radius.time);
    end = Math.max(end, point.position + point.radius.time);
    low = Math.min(low, point.frequency - point.radius.frequency);
    high = Math.max(high, point.frequency + point.radius.frequency);
  }
  return { start, end, low, high };
}

/** The union of `bounds`, the first given. */
function joined(first: SpectralBounds, rest: readonly SpectralBounds[]): SpectralBounds {
  let { start, end, low, high } = first;
  for (const each of rest) {
    start = Math.min(start, each.start);
    end = Math.max(end, each.end);
    low = Math.min(low, each.low);
    high = Math.max(high, each.high);
  }
  return { start, end, low, high };
}

/**
 * The bounds of the shapes that add to a mask, as drawn: what a selection's
 * range and band are (`ADR-0042` amended). A shape that only takes away
 * widens nothing.
 */
export function maskOutline(mask: SpectralMask): SpectralBounds {
  const adding = mask.shapes.filter((shape) => shape.effect === MaskEffect.Add).map(shapeOutline);
  const [first, ...rest] = adding;
  return first === undefined ? shapeOutline(mask.shapes[0]) : joined(first, rest);
}

/**
 * The bounds outside which a mask weighs nothing: its adding shapes' support.
 * A spectral edit changes no frame centred outside them (ADR-0081).
 */
export function maskSupport(mask: SpectralMask): SpectralBounds {
  const adding = mask.shapes
    .filter((shape) => shape.effect === MaskEffect.Add)
    .map((shape) => shapeSupport(shape, mask.feather));
  const [first, ...rest] = adding;
  return first === undefined ? shapeSupport(mask.shapes[0], mask.feather) : joined(first, rest);
}

function movedPoint<P extends SpectralPoint>(point: P, by: number): P {
  return { ...point, position: derivedSampleCount(point.position + by) };
}

/**
 * `mask` with every position moved by `by` samples: a selection's mask stated
 * relative to the start of an edit's range, or an edit's placed back on its
 * asset. The caller moves a mask only within the range that holds it, so no
 * position leaves the timeline.
 */
export function translatedMask(mask: SpectralMask, by: number): SpectralMask {
  const moved = (shape: SpectralShape): SpectralShape => {
    switch (shape.kind) {
      case 'rectangle':
        return {
          ...shape,
          range: {
            start: derivedSampleCount(shape.range.start + by),
            end: derivedSampleCount(shape.range.end + by),
          },
        };
      case 'polygon': {
        const [a, b, c, ...rest] = shape.points;
        return {
          ...shape,
          points: [
            movedPoint(a, by),
            movedPoint(b, by),
            movedPoint(c, by),
            ...rest.map((point) => movedPoint(point, by)),
          ],
        };
      }
      case 'stroke': {
        const [first, ...rest] = shape.points;
        return {
          ...shape,
          points: [movedPoint(first, by), ...rest.map((point) => movedPoint(point, by))],
        };
      }
    }
  };
  const [first, ...rest] = mask.shapes;
  return { feather: mask.feather, shapes: [moved(first), ...rest.map(moved)] };
}

function pointsEqual(left: SpectralPoint, right: SpectralPoint): boolean {
  return left.position === right.position && left.frequency === right.frequency;
}

function strokePointsEqual(left: StrokePoint, right: StrokePoint): boolean {
  return (
    pointsEqual(left, right) &&
    left.strength === right.strength &&
    left.radius.time === right.radius.time &&
    left.radius.frequency === right.radius.frequency
  );
}

function everyPair<T>(
  left: readonly T[],
  right: readonly T[],
  same: (a: T, b: T) => boolean,
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return other !== undefined && same(item, other);
    })
  );
}

function shapesEqual(left: SpectralShape, right: SpectralShape): boolean {
  if (left.effect !== right.effect) return false;
  switch (left.kind) {
    case 'rectangle':
      return (
        right.kind === 'rectangle' &&
        left.range.start === right.range.start &&
        left.range.end === right.range.end &&
        left.band.low === right.band.low &&
        left.band.high === right.band.high
      );
    case 'polygon':
      return right.kind === 'polygon' && everyPair(left.points, right.points, pointsEqual);
    case 'stroke':
      return (
        right.kind === 'stroke' &&
        left.hardness === right.hardness &&
        everyPair(left.points, right.points, strokePointsEqual)
      );
  }
}

/** Whether two masks are the same value: the same shapes, in order, and the same feather. */
export function masksEqual(left: SpectralMask, right: SpectralMask): boolean {
  return (
    left.feather.time === right.feather.time &&
    left.feather.frequency === right.feather.frequency &&
    everyPair(left.shapes, right.shapes, shapesEqual)
  );
}
