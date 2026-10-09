/**
 * Reading edit operations: one of an asset's chain, and one of a region's own
 * processing (ADR-0051, REQ-EXEC-136.12).
 *
 * An operation is read here by its shape and its bounds, each kind with its own
 * members and no other. Whether it may stand where it does (its range inside
 * the timeline the operations before it left, its channels channels of the
 * layout there, a paste's plan whole) is decided by the domain's validation of
 * the chain, which a document's reader and a command both run.
 */

import {
  FadeDirection,
  type EditOperation,
  type EditRange,
  type RangeEdit,
  type RegionOperation,
} from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import {
  MAXIMUM_CHAIN_LENGTH,
  asBasis,
  asChannel,
  asChannelGains,
  asChannelMatrix,
  asChannelScope,
  asFadeShape,
  asLevelGain,
} from './edit-value-reading.js';
import { WRITTEN_PLAN_DEPTH, readEditPlan } from './plan-reading.js';
import { asId, integerConverter, oneOfConverter } from './scalar-reading.js';
import { asChannelLayout, asSampleCount, asSampleRate } from './value-reading.js';

/**
 * How many levels of arrays and objects a written operation of an asset's
 * chain takes, its own object the first: a paste's plan, one level down, is
 * the deepest thing any operation holds. A region's operations hold no plan.
 */
export const WRITTEN_OPERATION_DEPTH = 1 + WRITTEN_PLAN_DEPTH;

const RANGE_MEMBERS: ReadonlySet<string> = new Set(['start', 'end']);

/**
 * The version of the engine's algorithm a stretch or a conversion of rate was
 * made by: a whole number from 1. Which versions this build has is the
 * engine's to say, where a plan is built, so any is read here.
 */
const asAlgorithmVersion = integerConverter(1, 1_000_000);
const REGION_OPERATION_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'basis',
  'range',
  'channels',
  'edit',
]);

/**
 * The members of each kind of operation in an asset's chain. A table over
 * every kind, so a kind the domain adds fails to compile here until it says
 * what it holds.
 */
const OPERATION_MEMBERS: Readonly<Record<EditOperation['kind'], ReadonlySet<string>>> = {
  delete: new Set(['id', 'kind', 'range']),
  trim: new Set(['id', 'kind', 'range']),
  reverse: new Set(['id', 'kind', 'range']),
  insert: new Set(['id', 'kind', 'at', 'payload', 'resampler']),
  process: new Set(['id', 'kind', 'range', 'channels', 'edit']),
  'convert-layout': new Set(['id', 'kind', 'layout', 'matrix']),
  stretch: new Set(['id', 'kind', 'range', 'length', 'version']),
  'convert-rate': new Set(['id', 'kind', 'sampleRate', 'version']),
};

/** The members of each kind of range edit, a table over every kind for the same reason. */
const RANGE_EDIT_MEMBERS: Readonly<Record<RangeEdit['kind'], ReadonlySet<string>>> = {
  gain: new Set(['kind', 'gain']),
  fade: new Set(['kind', 'direction', 'shape']),
  silence: new Set(['kind']),
  invert: new Set(['kind']),
  'swap-channels': new Set(['kind', 'first', 'second']),
  'copy-channel': new Set(['kind', 'from', 'to']),
  'channel-gains': new Set(['kind', 'gains']),
  rack: new Set(['kind', 'chain']),
  punch: new Set(['kind', 'stack']),
};

/** The kinds a table names, which are its own keys. */
function kindsOf<TKind extends string>(table: Readonly<Record<TKind, unknown>>): TKind[] {
  return Object.keys(table).filter((key): key is TKind => Object.hasOwn(table, key));
}

const asOperationKind = oneOfConverter(kindsOf(OPERATION_MEMBERS));
const asRangeEditKind = oneOfConverter(kindsOf(RANGE_EDIT_MEMBERS));
const asFadeDirection = oneOfConverter(Object.values(FadeDirection));

/** Reads a span between two sample boundaries. */
export const readEditRange: Converter<EditRange> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RANGE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const start = required(reading, object, at, 'start', asSampleCount);
  const end = required(reading, object, at, 'end', asSampleCount);
  return start === undefined || end === undefined ? undefined : { start, end };
};

/** Reads a change over a range that moves nothing in time. */
const readRangeEdit: Converter<RangeEdit> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asRangeEditKind);
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, RANGE_EDIT_MEMBERS[kind]);
  switch (kind) {
    case 'gain': {
      const gain = required(reading, object, at, 'gain', asLevelGain);
      return gain === undefined ? undefined : { kind, gain };
    }
    case 'fade': {
      const direction = required(reading, object, at, 'direction', asFadeDirection);
      const shape = required(reading, object, at, 'shape', asFadeShape);
      return direction === undefined || shape === undefined
        ? undefined
        : { kind, direction, shape };
    }
    case 'silence':
    case 'invert':
      return { kind };
    case 'swap-channels': {
      const first = required(reading, object, at, 'first', asChannel);
      const second = required(reading, object, at, 'second', asChannel);
      return first === undefined || second === undefined ? undefined : { kind, first, second };
    }
    case 'copy-channel': {
      const from = required(reading, object, at, 'from', asChannel);
      const to = required(reading, object, at, 'to', asChannel);
      return from === undefined || to === undefined ? undefined : { kind, from, to };
    }
    case 'channel-gains': {
      const gains = required(reading, object, at, 'gains', asChannelGains);
      return gains === undefined ? undefined : { kind, gains };
    }
    case 'rack': {
      const chain = required(reading, object, at, 'chain', asId<'EffectChainId'>);
      return chain === undefined ? undefined : { kind, chain };
    }
    case 'punch': {
      const stack = required(reading, object, at, 'stack', asId<'TakeStackId'>);
      return stack === undefined ? undefined : { kind, stack };
    }
  }
};

/** Reads one operation of an asset's chain. */
export const readEditOperation: Converter<EditOperation> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asId<'EditOperationId'>);
  const kind = required(reading, object, at, 'kind', asOperationKind);
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, OPERATION_MEMBERS[kind]);
  const body = operationBody(reading, object, at, kind);
  return id === undefined || body === undefined ? undefined : { id, ...body };
};

/** Each kind of a union without its identifier, the union kept kind by kind. */
type WithoutId<TValue> = TValue extends unknown ? Omit<TValue, 'id'> : never;

/** An operation without its identifier, which every kind carries alike. */
type OperationBody = WithoutId<EditOperation>;

function operationBody(
  reading: Reading,
  object: JsonObject,
  at: string,
  kind: EditOperation['kind'],
): OperationBody | undefined {
  switch (kind) {
    case 'delete':
    case 'trim':
    case 'reverse': {
      const range = required(reading, object, at, 'range', readEditRange);
      return range === undefined ? undefined : { kind, range };
    }
    case 'insert': {
      const position = required(reading, object, at, 'at', asSampleCount);
      const payload = required(reading, object, at, 'payload', readEditPlan);
      const resampler = optional(reading, object, at, 'resampler', asAlgorithmVersion);
      return position === undefined || payload === undefined
        ? undefined
        : { kind, at: position, payload, ...(resampler === undefined ? {} : { resampler }) };
    }
    case 'process': {
      const range = required(reading, object, at, 'range', readEditRange);
      const channels = optional(reading, object, at, 'channels', asChannelScope);
      const edit = required(reading, object, at, 'edit', readRangeEdit);
      return range === undefined || edit === undefined
        ? undefined
        : { kind, range, ...(channels === undefined ? {} : { channels }), edit };
    }
    case 'convert-layout': {
      const layout = required(reading, object, at, 'layout', asChannelLayout);
      const matrix = required(reading, object, at, 'matrix', asChannelMatrix);
      return layout === undefined || matrix === undefined ? undefined : { kind, layout, matrix };
    }
    case 'stretch': {
      const range = required(reading, object, at, 'range', readEditRange);
      const length = required(reading, object, at, 'length', asSampleCount);
      const version = required(reading, object, at, 'version', asAlgorithmVersion);
      return range === undefined || length === undefined || version === undefined
        ? undefined
        : { kind, range, length, version };
    }
    case 'convert-rate': {
      const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
      const version = required(reading, object, at, 'version', asAlgorithmVersion);
      return sampleRate === undefined || version === undefined
        ? undefined
        : { kind, sampleRate, version };
    }
  }
}

/** Reads an asset's chain, in its order. */
export const asEditChain = listConverter(MAXIMUM_CHAIN_LENGTH, readEditOperation);

/** Reads one operation of a region's own processing. */
export const readRegionOperation: Converter<RegionOperation> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, REGION_OPERATION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asId<'EditOperationId'>);
  const basis = required(reading, object, at, 'basis', asBasis);
  const range = required(reading, object, at, 'range', readEditRange);
  const channels = optional(reading, object, at, 'channels', asChannelScope);
  const edit = required(reading, object, at, 'edit', readRangeEdit);
  return id === undefined || basis === undefined || range === undefined || edit === undefined
    ? undefined
    : { id, basis, range, ...(channels === undefined ? {} : { channels }), edit };
};

/** Reads a region's own processing, in its order. */
export const asRegionChain = listConverter(MAXIMUM_CHAIN_LENGTH, readRegionOperation);
