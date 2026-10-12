/**
 * Whether a spectral mask may stand in a timeline: the one check, for a
 * selection a tool makes and for an edit a document holds (ADR-0081).
 *
 * A mask arrives in a project document, a journal or a clipboard that another
 * tab or a hostile file may have written, so every number is checked before
 * any arithmetic reads it, and its size is bounded so a document cannot make
 * a weight cost without end.
 */

import {
  HIGHEST_MASK_FREQUENCY,
  MaskEffect,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
  type StrokePoint,
} from './spectral-mask.js';

/** The most shapes a mask may hold. */
export const MAXIMUM_MASK_SHAPES = 1_024;

/** The most points all a mask's polygons and strokes may hold together. */
export const MAXIMUM_MASK_POINTS = 65_536;

/** Whether `value` is a position from 0 to `length`. */
function isPosition(value: number, length: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= length;
}

/** Whether `value` is a frequency a mask may name. */
function isFrequency(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= HIGHEST_MASK_FREQUENCY;
}

function pointProblem(point: SpectralPoint, length: number): string | undefined {
  if (!isPosition(point.position, length))
    return 'A point of the selection lies outside the audio.';
  return isFrequency(point.frequency)
    ? undefined
    : 'A point of the selection names a frequency no audio has.';
}

function strokePointProblem(point: StrokePoint, length: number): string | undefined {
  const problem = pointProblem(point, length);
  if (problem !== undefined) return problem;
  if (!(Number.isFinite(point.strength) && point.strength > 0 && point.strength <= 1)) {
    return 'A brush’s strength must be above nothing and at most full.';
  }
  return Number.isFinite(point.radius.time) &&
    point.radius.time > 0 &&
    point.radius.time <= length + 1 &&
    Number.isFinite(point.radius.frequency) &&
    point.radius.frequency > 0 &&
    point.radius.frequency <= HIGHEST_MASK_FREQUENCY
    ? undefined
    : 'A brush’s size must be above nothing and within the audio.';
}

function shapeProblem(shape: SpectralShape, length: number): string | undefined {
  switch (shape.kind) {
    case 'rectangle':
      if (
        !isPosition(shape.range.start, length) ||
        !isPosition(shape.range.end, length) ||
        shape.range.start >= shape.range.end
      ) {
        return 'A rectangle of the selection covers no audio.';
      }
      return isFrequency(shape.band.low) &&
        isFrequency(shape.band.high) &&
        shape.band.low < shape.band.high
        ? undefined
        : 'A rectangle of the selection covers no frequencies.';
    case 'polygon':
      for (const point of shape.points) {
        const problem = pointProblem(point, length);
        if (problem !== undefined) return problem;
      }
      return undefined;
    case 'stroke':
      if (!(Number.isFinite(shape.hardness) && shape.hardness >= 0 && shape.hardness < 1)) {
        return 'A brush’s hardness must be from nothing to just below full.';
      }
      for (const point of shape.points) {
        const problem = strokePointProblem(point, length);
        if (problem !== undefined) return problem;
      }
      return undefined;
  }
}

/** Why `mask` may not stand in a timeline of `length`, or `undefined` where it may. */
export function maskProblem(mask: SpectralMask, length: number): string | undefined {
  const { feather } = mask;
  const featherValid =
    Number.isFinite(feather.time) &&
    Number.isFinite(feather.frequency) &&
    feather.time >= 0 &&
    feather.frequency >= 0 &&
    feather.time <= length + 1 &&
    feather.frequency <= HIGHEST_MASK_FREQUENCY &&
    feather.time > 0 === feather.frequency > 0;
  if (!featherValid) {
    return 'A selection’s softness is either none or some in both time and frequency.';
  }
  if (mask.shapes.length > MAXIMUM_MASK_SHAPES) return 'The selection has too many shapes.';
  let points = 0;
  for (const shape of mask.shapes) {
    if (shape.kind !== 'rectangle') points += shape.points.length;
    if (points > MAXIMUM_MASK_POINTS) return 'The selection has too many points.';
    const problem = shapeProblem(shape, length);
    if (problem !== undefined) return problem;
  }
  return mask.shapes.some((shape) => shape.effect === MaskEffect.Add)
    ? undefined
    : 'A selection needs a shape that adds to it.';
}
