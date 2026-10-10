/**
 * A spectral mask read back from a value that crossed a thread (ADR-0052,
 * ADR-0081).
 *
 * A mask crosses to the workers inside a plan, and a worker trusts no
 * message, so each member's type is checked here by the one reader of a
 * message's fields, and the number of shapes and points is bounded before
 * anything reads them. Whether the values make a mask is then
 * `maskProblem`'s, which `validatePlan` asks.
 */

import {
  Malformed,
  boundedItemsOf,
  fieldsOf,
  numberOf,
  oneOfValues,
  sampleCountOf,
  type MessageFields,
} from '../messages/message-fields.js';
import { MAXIMUM_MASK_POINTS, MAXIMUM_MASK_SHAPES } from './mask-validation.js';
import {
  MaskEffect,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
  type StrokePoint,
} from './spectral-mask.js';

function pointOf(value: unknown, field: string): SpectralPoint {
  const read = fieldsOf(value, field);
  return {
    position: sampleCountOf(read['position'], `${field}.position`),
    frequency: numberOf(read['frequency'], `${field}.frequency`),
  };
}

function strokePointOf(value: unknown, field: string): StrokePoint {
  const read = fieldsOf(value, field);
  const radius = fieldsOf(read['radius'], `${field}.radius`);
  return {
    ...pointOf(value, field),
    strength: numberOf(read['strength'], `${field}.strength`),
    radius: {
      time: numberOf(radius['time'], `${field}.radius.time`),
      frequency: numberOf(radius['frequency'], `${field}.radius.frequency`),
    },
  };
}

function rectangleOf(read: MessageFields, field: string, effect: MaskEffect): SpectralShape {
  const range = fieldsOf(read['range'], `${field}.range`);
  const band = fieldsOf(read['band'], `${field}.band`);
  return {
    kind: 'rectangle',
    effect,
    range: {
      start: sampleCountOf(range['start'], `${field}.range.start`),
      end: sampleCountOf(range['end'], `${field}.range.end`),
    },
    band: {
      low: numberOf(band['low'], `${field}.band.low`),
      high: numberOf(band['high'], `${field}.band.high`),
    },
  };
}

function polygonOf(read: MessageFields, field: string, effect: MaskEffect): SpectralShape {
  const points = boundedItemsOf(read['points'], `${field}.points`, MAXIMUM_MASK_POINTS, pointOf);
  const [a, b, c, ...rest] = points;
  if (a === undefined || b === undefined || c === undefined) {
    throw new Malformed(`${field}.points`, 'three or more points');
  }
  return { kind: 'polygon', effect, points: [a, b, c, ...rest] };
}

function strokeOf(read: MessageFields, field: string, effect: MaskEffect): SpectralShape {
  const points = boundedItemsOf(
    read['points'],
    `${field}.points`,
    MAXIMUM_MASK_POINTS,
    strokePointOf,
  );
  const [first, ...rest] = points;
  if (first === undefined) throw new Malformed(`${field}.points`, 'one or more points');
  return {
    kind: 'stroke',
    effect,
    hardness: numberOf(read['hardness'], `${field}.hardness`),
    points: [first, ...rest],
  };
}

function shapeOf(value: unknown, field: string): SpectralShape {
  const read = fieldsOf(value, field);
  const effect = oneOfValues(read['effect'], `${field}.effect`, MaskEffect);
  switch (read['kind']) {
    case 'rectangle':
      return rectangleOf(read, field, effect);
    case 'polygon':
      return polygonOf(read, field, effect);
    case 'stroke':
      return strokeOf(read, field, effect);
    default:
      throw new Malformed(`${field}.kind`, 'rectangle, polygon or stroke');
  }
}

/** The mask `value` holds, named `field`, read member by member. */
export function spectralMaskOf(value: unknown, field: string): SpectralMask {
  const read = fieldsOf(value, field);
  const feather = fieldsOf(read['feather'], `${field}.feather`);
  const shapes = boundedItemsOf(read['shapes'], `${field}.shapes`, MAXIMUM_MASK_SHAPES, shapeOf);
  const [first, ...rest] = shapes;
  if (first === undefined) throw new Malformed(`${field}.shapes`, 'one or more shapes');
  return {
    shapes: [first, ...rest],
    feather: {
      time: numberOf(feather['time'], `${field}.feather.time`),
      frequency: numberOf(feather['frequency'], `${field}.feather.frequency`),
    },
  };
}
