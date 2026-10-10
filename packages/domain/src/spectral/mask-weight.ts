/**
 * How much of a point of time and frequency a spectral mask covers, from 0 to
 * 1: the one statement of it (ADR-0081).
 *
 * A mask's weight is the largest weight of its adding shapes, times one less
 * the largest of its subtracting ones.
 *
 * - A rectangle or a polygon weighs 1 inside it, edges included. Outside it,
 *   where the mask has a feather, it weighs `1 − d`, `d` being the distance
 *   to it measured in feathers (a sample's distance over the feather's
 *   samples, a hertz's over its hertz), and nothing from `d = 1` on. A polygon
 *   is inside by the even-odd rule, counting the crossings of its edges above
 *   the point at its position, an edge crossing a position from its start
 *   inclusive to its end exclusive.
 * - A stroke weighs, at each step from one of its points to the next, the
 *   point of the step nearest the given one, measured in the mean of the two
 *   points' radii, with the strength and the radius interpolated there; it
 *   weighs that strength out to `hardness` of the radius and falls linearly
 *   to nothing at the radius.
 *
 * Only addition, subtraction, multiplication, division, the square root and
 * comparison are used, each correctly rounded (ADR-0032), so every machine
 * finds the same weight. A row of bins is evaluated at once, which is how
 * the engine reads a mask for a frame and the view for a column of pixels;
 * a single point is a row of one, so the two cannot differ.
 */

import {
  MaskEffect,
  shapeSupport,
  type SpectralBounds,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
  type StrokePoint,
} from './spectral-mask.js';

/** A shape ready to be read row by row, with its support worked out once. */
interface PreparedShape {
  readonly shape: SpectralShape;
  readonly support: SpectralBounds;
}

/** The distance from `(px, py)` to the segment from the origin to `(ex, ey)`. */
function segmentDistance(px: number, py: number, ex: number, ey: number): number {
  const along = ex * ex + ey * ey;
  let u = along > 0 ? (px * ex + py * ey) / along : 0;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const dx = px - u * ex;
  const dy = py - u * ey;
  return Math.sqrt(dx * dx + dy * dy);
}

/** A feather's weight at `distance` feathers outside a shape. */
function feathered(distance: number): number {
  return distance < 1 ? 1 - distance : 0;
}

/** The first index of ascending `values` not below `value`. */
function firstAtOrAbove(values: Float64Array, value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The first index of ascending `values` above `value`. */
function firstAbove(values: Float64Array | readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? 0) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * A mask read row by row: the weights of one position at many frequencies.
 *
 * It keeps the buffers a row is worked in, so reading a row allocates nothing
 * once the rows are as long as the longest it has read.
 */
export class MaskWeights {
  readonly #mask: SpectralMask;
  readonly #shapes: readonly PreparedShape[];
  #added = new Float64Array(0);
  #taken = new Float64Array(0);
  #crossings: number[] = [];

  constructor(mask: SpectralMask) {
    this.#mask = mask;
    this.#shapes = mask.shapes.map((shape) => ({
      shape,
      support: shapeSupport(shape, mask.feather),
    }));
  }

  /**
   * Writes into `into` the mask's weight at `position` and each of
   * `frequencies`, which ascend; `into` is at least as long.
   */
  row(position: number, frequencies: Float64Array, into: Float64Array): void {
    const count = frequencies.length;
    if (this.#added.length < count) {
      this.#added = new Float64Array(count);
      this.#taken = new Float64Array(count);
    }
    const added = this.#added;
    const taken = this.#taken;
    added.fill(0, 0, count);
    taken.fill(0, 0, count);
    let anyTaken = false;
    for (const { shape, support } of this.#shapes) {
      if (position < support.start || position > support.end) continue;
      const from = firstAtOrAbove(frequencies, support.low);
      const to = firstAbove(frequencies, support.high);
      if (from >= to) continue;
      const target = shape.effect === MaskEffect.Add ? added : taken;
      if (shape.effect === MaskEffect.Subtract) anyTaken = true;
      this.#shapeRow(shape, position, frequencies, from, to, target);
    }
    for (let index = 0; index < count; index += 1) {
      const weight = added[index] ?? 0;
      into[index] = anyTaken ? weight * (1 - (taken[index] ?? 0)) : weight;
    }
  }

  /** The mask's weight at one point. */
  at(position: number, frequency: number): number {
    const into = new Float64Array(1);
    this.row(position, Float64Array.of(frequency), into);
    return into[0] ?? 0;
  }

  /** Raises `target` to the shape's weight at each bin from `from` to `to`. */
  #shapeRow(
    shape: SpectralShape,
    position: number,
    frequencies: Float64Array,
    from: number,
    to: number,
    target: Float64Array,
  ): void {
    switch (shape.kind) {
      case 'rectangle':
        this.#rectangleRow(shape, position, frequencies, from, to, target);
        return;
      case 'polygon':
        this.#polygonRow(shape.points, position, frequencies, from, to, target);
        return;
      case 'stroke':
        strokeRow(shape.points, shape.hardness, position, frequencies, from, to, target);
        return;
    }
  }

  #rectangleRow(
    shape: Extract<SpectralShape, { readonly kind: 'rectangle' }>,
    position: number,
    frequencies: Float64Array,
    from: number,
    to: number,
    target: Float64Array,
  ): void {
    const { feather } = this.#mask;
    const { start, end } = shape.range;
    const { low, high } = shape.band;
    const before = position < start ? start - position : position > end ? position - end : 0;
    const dx = before === 0 ? 0 : feather.time > 0 ? before / feather.time : Infinity;
    for (let index = from; index < to; index += 1) {
      const frequency = frequencies[index] ?? 0;
      const outside = frequency < low ? low - frequency : frequency > high ? frequency - high : 0;
      let weight: number;
      if (dx === 0 && outside === 0) weight = 1;
      else if (feather.frequency <= 0 || dx === Infinity) weight = 0;
      else {
        const dy = outside / feather.frequency;
        weight = feathered(Math.sqrt(dx * dx + dy * dy));
      }
      if (weight > (target[index] ?? 0)) target[index] = weight;
    }
  }

  #polygonRow(
    points: readonly SpectralPoint[],
    position: number,
    frequencies: Float64Array,
    from: number,
    to: number,
    target: Float64Array,
  ): void {
    const crossings = this.#crossings;
    crossings.length = 0;
    const count = points.length;
    for (let index = 0; index < count; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % count];
      if (a === undefined || b === undefined || a.position === b.position) continue;
      const crosses =
        (a.position <= position && position < b.position) ||
        (b.position <= position && position < a.position);
      if (!crosses) continue;
      crossings.push(
        a.frequency +
          ((position - a.position) * (b.frequency - a.frequency)) / (b.position - a.position),
      );
    }
    crossings.sort((left, right) => left - right);
    const { feather } = this.#mask;
    const soft = feather.time > 0 && feather.frequency > 0;
    for (let index = from; index < to; index += 1) {
      const frequency = frequencies[index] ?? 0;
      const above = crossings.length - firstAbove(crossings, frequency);
      let weight: number;
      if (above % 2 === 1) weight = 1;
      else if (!soft) weight = 0;
      else weight = feathered(edgeDistance(points, position, frequency, feather));
      if (weight > (target[index] ?? 0)) target[index] = weight;
    }
  }
}

/** The distance in feathers from a point to the nearest edge of a polygon. */
function edgeDistance(
  points: readonly SpectralPoint[],
  position: number,
  frequency: number,
  feather: { readonly time: number; readonly frequency: number },
): number {
  let nearest = Infinity;
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % count];
    if (a === undefined || b === undefined) continue;
    // An edge whose span lies a feather or more from the position is a
    // feather or more away, so it cannot be the nearest that weighs.
    if (
      Math.min(a.position, b.position) - feather.time > position ||
      Math.max(a.position, b.position) + feather.time < position
    ) {
      continue;
    }
    const distance = segmentDistance(
      (position - a.position) / feather.time,
      (frequency - a.frequency) / feather.frequency,
      (b.position - a.position) / feather.time,
      (b.frequency - a.frequency) / feather.frequency,
    );
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

/** A stroke's weight from one point to the next, at `(position, frequency)`. */
function stepWeight(
  a: StrokePoint,
  b: StrokePoint,
  hardness: number,
  position: number,
  frequency: number,
): number {
  const meanTime = (a.radius.time + b.radius.time) / 2;
  const meanFrequency = (a.radius.frequency + b.radius.frequency) / 2;
  const ex = (b.position - a.position) / meanTime;
  const ey = (b.frequency - a.frequency) / meanFrequency;
  const along = ex * ex + ey * ey;
  let u =
    along > 0
      ? (((position - a.position) / meanTime) * ex +
          ((frequency - a.frequency) / meanFrequency) * ey) /
        along
      : 0;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const centreTime = a.position + u * (b.position - a.position);
  const centreFrequency = a.frequency + u * (b.frequency - a.frequency);
  const radiusTime = a.radius.time + u * (b.radius.time - a.radius.time);
  const radiusFrequency = a.radius.frequency + u * (b.radius.frequency - a.radius.frequency);
  const strength = a.strength + u * (b.strength - a.strength);
  const dx = (position - centreTime) / radiusTime;
  const dy = (frequency - centreFrequency) / radiusFrequency;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= hardness) return strength;
  return distance < 1 ? (strength * (1 - distance)) / (1 - hardness) : 0;
}

/** Raises `target` to a stroke's weight at each bin from `from` to `to`. */
function strokeRow(
  points: readonly [StrokePoint, ...StrokePoint[]],
  hardness: number,
  position: number,
  frequencies: Float64Array,
  from: number,
  to: number,
  target: Float64Array,
): void {
  const steps = Math.max(points.length - 1, 1);
  for (let step = 0; step < steps; step += 1) {
    const a = points[step] ?? points[0];
    const b = points[step + 1] ?? a;
    if (
      Math.min(a.position - a.radius.time, b.position - b.radius.time) > position ||
      Math.max(a.position + a.radius.time, b.position + b.radius.time) < position
    ) {
      continue;
    }
    const low = Math.min(a.frequency - a.radius.frequency, b.frequency - b.radius.frequency);
    const high = Math.max(a.frequency + a.radius.frequency, b.frequency + b.radius.frequency);
    const first = Math.max(from, firstAtOrAbove(frequencies, low));
    const last = Math.min(to, firstAbove(frequencies, high));
    for (let index = first; index < last; index += 1) {
      const weight = stepWeight(a, b, hardness, position, frequencies[index] ?? 0);
      if (weight > (target[index] ?? 0)) target[index] = weight;
    }
  }
}
