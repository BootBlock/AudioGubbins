/**
 * Reading a spectral edit's mask and operation (ADR-0081, REQ-EXEC-136.12):
 * the one reader of each, for an asset's chain, a region's processing and a
 * plan's spectral stream.
 *
 * Each value is read here by its shape and its bounds, each kind with its own
 * members and no other, and the number of shapes and points is bounded as the
 * domain bounds them. Whether a mask lies within its range, a resolution is
 * one this build analyses with and a chain is the project's is the domain's
 * validation, which a document's reader and a command both run.
 */

import {
  HIGHEST_MASK_FREQUENCY,
  LARGEST_SPECTRAL_RESOLUTION,
  MAXIMUM_MASK_POINTS,
  MAXIMUM_MASK_SHAPES,
  MaskEffect,
  SMALLEST_SPECTRAL_RESOLUTION,
  type BrushRadius,
  type PlannedSpectralOperation,
  type SpectralEdit,
  type SpectralEditOperation,
  type SpectralFeather,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
  type StrokePoint,
} from '@audiogubbins/domain';

import { readEffectChain } from './chain-reading.js';
import type { JsonObject } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  listConverter,
  objectOf,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { asId, integerConverter, numberConverter, oneOfConverter } from './scalar-reading.js';
import { asChannelLayout, asSampleCount } from './value-reading.js';

/**
 * How many levels of arrays and objects a written mask takes, its own object
 * the first: its shapes, a shape, its points, a point and the point's radius.
 */
export const WRITTEN_MASK_DEPTH = 6;

const MASK_MEMBERS: ReadonlySet<string> = new Set(['shapes', 'feather']);
const FEATHER_MEMBERS: ReadonlySet<string> = new Set(['time', 'frequency']);
const RANGE_MEMBERS: ReadonlySet<string> = new Set(['start', 'end']);
const BAND_MEMBERS: ReadonlySet<string> = new Set(['low', 'high']);
const POINT_MEMBERS: ReadonlySet<string> = new Set(['position', 'frequency']);
const STROKE_POINT_MEMBERS: ReadonlySet<string> = new Set([
  'position',
  'frequency',
  'strength',
  'radius',
]);
const RADIUS_MEMBERS: ReadonlySet<string> = new Set(['time', 'frequency']);

/** The members of each kind of shape. */
const SHAPE_MEMBERS: Readonly<Record<SpectralShape['kind'], ReadonlySet<string>>> = {
  rectangle: new Set(['kind', 'effect', 'range', 'band']),
  polygon: new Set(['kind', 'effect', 'points']),
  stroke: new Set(['kind', 'effect', 'hardness', 'points']),
};

/** The members of each kind of operation. */
const OPERATION_MEMBERS: Readonly<Record<SpectralEditOperation['kind'], ReadonlySet<string>>> = {
  attenuate: new Set(['kind', 'gain']),
  isolate: new Set(['kind', 'gain']),
  heal: new Set(['kind']),
  process: new Set(['kind', 'chain']),
};

/** A planned `process` operation carries its chain whole, and the layout the chain reads. */
const PLANNED_PROCESS_MEMBERS: ReadonlySet<string> = new Set(['kind', 'chain', 'input']);

const asShapeKind = oneOfConverter(['rectangle', 'polygon', 'stroke'] as const);
const asOperationKind = oneOfConverter(['attenuate', 'isolate', 'heal', 'process'] as const);
const asEffect = oneOfConverter(Object.values(MaskEffect));
const asFrequency = numberConverter(0, HIGHEST_MASK_FREQUENCY);
const asUnit = numberConverter(0, 1);
const asSpan = numberConverter(0, Number.MAX_SAFE_INTEGER);

/** A resolution a spectral edit may have; the domain asks that it be a power of two. */
export const asSpectralResolution = integerConverter(
  SMALLEST_SPECTRAL_RESOLUTION,
  LARGEST_SPECTRAL_RESOLUTION,
);

const readPoint: Converter<SpectralPoint> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, POINT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const position = required(reading, object, at, 'position', asSampleCount);
  const frequency = required(reading, object, at, 'frequency', asFrequency);
  return position === undefined || frequency === undefined ? undefined : { position, frequency };
};

const readRadius: Converter<BrushRadius> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RADIUS_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const time = required(reading, object, at, 'time', asSpan);
  const frequency = required(reading, object, at, 'frequency', asFrequency);
  return time === undefined || frequency === undefined ? undefined : { time, frequency };
};

const readStrokePoint: Converter<StrokePoint> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, STROKE_POINT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const position = required(reading, object, at, 'position', asSampleCount);
  const frequency = required(reading, object, at, 'frequency', asFrequency);
  const strength = required(reading, object, at, 'strength', asUnit);
  const radius = required(reading, object, at, 'radius', readRadius);
  return position === undefined ||
    frequency === undefined ||
    strength === undefined ||
    radius === undefined
    ? undefined
    : { position, frequency, strength, radius };
};

const asPoints = listConverter(MAXIMUM_MASK_POINTS, readPoint);
const asStrokePoints = listConverter(MAXIMUM_MASK_POINTS, readStrokePoint);

function readRange(
  reading: Reading,
  object: JsonObject,
  at: string,
): Extract<SpectralShape, { readonly kind: 'rectangle' }>['range'] | undefined {
  return required(reading, object, at, 'range', (inner, value, parent, key) => {
    const range = objectOf(inner, value, parent, key, RANGE_MEMBERS);
    if (range === undefined) return undefined;
    const path = pathOf(parent, key);
    const start = required(inner, range, path, 'start', asSampleCount);
    const end = required(inner, range, path, 'end', asSampleCount);
    return start === undefined || end === undefined ? undefined : { start, end };
  });
}

function readBand(
  reading: Reading,
  object: JsonObject,
  at: string,
): Extract<SpectralShape, { readonly kind: 'rectangle' }>['band'] | undefined {
  return required(reading, object, at, 'band', (inner, value, parent, key) => {
    const band = objectOf(inner, value, parent, key, BAND_MEMBERS);
    if (band === undefined) return undefined;
    const path = pathOf(parent, key);
    const low = required(inner, band, path, 'low', asFrequency);
    const high = required(inner, band, path, 'high', asFrequency);
    return low === undefined || high === undefined ? undefined : { low, high };
  });
}

const readShape: Converter<SpectralShape> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asShapeKind);
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, SHAPE_MEMBERS[kind]);
  const effect = required(reading, object, at, 'effect', asEffect);
  switch (kind) {
    case 'rectangle': {
      const range = readRange(reading, object, at);
      const band = readBand(reading, object, at);
      return effect === undefined || range === undefined || band === undefined
        ? undefined
        : { kind, effect, range, band };
    }
    case 'polygon': {
      const [a, b, c, ...rest] = required(reading, object, at, 'points', asPoints) ?? [];
      if (a === undefined || b === undefined || c === undefined) {
        reading.refuse('schema.too-few-items', 'A polygon has three or more points.', at);
        return undefined;
      }
      return effect === undefined ? undefined : { kind, effect, points: [a, b, c, ...rest] };
    }
    case 'stroke': {
      const hardness = required(reading, object, at, 'hardness', asUnit);
      const [first, ...rest] = required(reading, object, at, 'points', asStrokePoints) ?? [];
      if (first === undefined) {
        reading.refuse('schema.too-few-items', 'A stroke has one or more points.', at);
        return undefined;
      }
      return effect === undefined || hardness === undefined
        ? undefined
        : { kind, effect, hardness, points: [first, ...rest] };
    }
  }
};

const asShapes = listConverter(MAXIMUM_MASK_SHAPES, readShape);

const readFeather: Converter<SpectralFeather> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, FEATHER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const time = required(reading, object, at, 'time', asSpan);
  const frequency = required(reading, object, at, 'frequency', asFrequency);
  return time === undefined || frequency === undefined ? undefined : { time, frequency };
};

/** Reads a spectral mask. */
export const readSpectralMask: Converter<SpectralMask> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, MASK_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const [first, ...rest] = required(reading, object, at, 'shapes', asShapes) ?? [];
  const feather = required(reading, object, at, 'feather', readFeather);
  if (first === undefined) {
    reading.refuse('schema.too-few-items', 'A mask has one or more shapes.', at);
    return undefined;
  }
  return feather === undefined ? undefined : { shapes: [first, ...rest], feather };
};

/** The gain of an `attenuate` or an `isolate`, or `undefined` where it is not one. */
function readGain(reading: Reading, object: JsonObject, at: string): number | undefined {
  return required(reading, object, at, 'gain', asUnit);
}

/** Reads a spectral edit's operation as an edit holds it, naming its chain. */
const readSpectralOperation: Converter<SpectralEditOperation> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asOperationKind);
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, OPERATION_MEMBERS[kind]);
  switch (kind) {
    case 'attenuate':
    case 'isolate': {
      const gain = readGain(reading, object, at);
      return gain === undefined ? undefined : { kind, gain };
    }
    case 'heal':
      return { kind };
    case 'process': {
      const chain = required(reading, object, at, 'chain', asId<'EffectChainId'>);
      return chain === undefined ? undefined : { kind, chain };
    }
  }
};

/**
 * Reads the members of a spectral edit as an edit holds it, from the object
 * whose kind and members its reader has checked.
 */
export function readSpectralEditMembers(
  reading: Reading,
  object: JsonObject,
  at: string,
): Omit<SpectralEdit, 'kind'> | undefined {
  const mask = required(reading, object, at, 'mask', readSpectralMask);
  const resolution = required(reading, object, at, 'resolution', asSpectralResolution);
  const operation = required(reading, object, at, 'operation', readSpectralOperation);
  return mask === undefined || resolution === undefined || operation === undefined
    ? undefined
    : { mask, resolution, operation };
}

/** Reads a spectral edit's operation as a plan holds it, carrying its chain whole. */
export const readPlannedSpectralOperation: Converter<PlannedSpectralOperation> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asOperationKind);
  if (kind === undefined) return undefined;
  checkMembers(
    reading,
    object,
    at,
    kind === 'process' ? PLANNED_PROCESS_MEMBERS : OPERATION_MEMBERS[kind],
  );
  switch (kind) {
    case 'attenuate':
    case 'isolate': {
      const gain = readGain(reading, object, at);
      return gain === undefined ? undefined : { kind, gain };
    }
    case 'heal':
      return { kind };
    case 'process': {
      const chain = required(reading, object, at, 'chain', readEffectChain);
      const input = required(reading, object, at, 'input', asChannelLayout);
      return chain === undefined || input === undefined ? undefined : { kind, chain, input };
    }
  }
};
