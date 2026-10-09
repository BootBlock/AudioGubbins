/**
 * Reading take stacks: a stack, each take in it, and a punch stack's range
 * (ADR-0072, REQ-EXEC-136.12).
 *
 * Each value is read alone by its shape, which is how a command reads one it
 * carries. In a project each stack is then checked against the project's
 * assets by the domain's own rule, so every take names a recording the
 * project has and the chosen take is one the stack keeps; the punch edits
 * that name a stack are checked with the asset chains that hold them.
 */

import {
  TakeState,
  validateTakeStack,
  type Asset,
  type AssetId,
  type PunchCrossfade,
  type PunchRange,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';

import {
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
} from './document-reading.js';
import { asFadeShape } from './edit-value-reading.js';
import { asTakeName, asTakeStackName } from './given-names.js';
import { refuseFailed } from './placement-reading.js';
import { asId, integerConverter, oneOfConverter, textConverter } from './scalar-reading.js';
import { MAXIMUM_NESTED_ITEMS, asSampleCount } from './value-reading.js';

/** The longest note a take holds, in UTF-16 code units. */
export const LONGEST_TAKE_NOTE = 4_096;

const STACK_MEMBERS: ReadonlySet<string> = new Set(['id', 'name', 'takes', 'chosen', 'punch']);
const TAKE_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'asset',
  'name',
  'note',
  'state',
  'compensation',
]);
const PUNCH_MEMBERS: ReadonlySet<string> = new Set([
  'length',
  'preRoll',
  'postRoll',
  'crossfade',
  'resampler',
]);
const CROSSFADE_MEMBERS: ReadonlySet<string> = new Set(['length', 'shape']);

const asNote = textConverter({ maximumLength: LONGEST_TAKE_NOTE });
const asTakeState = oneOfConverter(Object.values(TakeState));

/** A take's compensation: a signed whole number of frames, whose bounds the domain sets. */
const asCompensation = integerConverter(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

/** The version of the resampler a punch converts a take by, as any algorithm's is read. */
const asResamplerVersion = integerConverter(1, 1_000_000);

/** Reads one take. */
export const readTake: Converter<Take> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, TAKE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asId<'TakeId'>);
  const asset = required(reading, object, at, 'asset', asId<'AssetId'>);
  const name = required(reading, object, at, 'name', asTakeName);
  const note = required(reading, object, at, 'note', asNote);
  const state = required(reading, object, at, 'state', asTakeState);
  const compensation = required(reading, object, at, 'compensation', asCompensation);
  return id === undefined ||
    asset === undefined ||
    name === undefined ||
    note === undefined ||
    state === undefined ||
    compensation === undefined
    ? undefined
    : { id, asset, name, note, state, compensation };
};

const readCrossfade: Converter<PunchCrossfade> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CROSSFADE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const length = required(reading, object, at, 'length', asSampleCount);
  const shape = required(reading, object, at, 'shape', asFadeShape);
  return length === undefined || shape === undefined ? undefined : { length, shape };
};

/** Reads a punch stack's range. */
export const readPunchRange: Converter<PunchRange> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, PUNCH_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const length = required(reading, object, at, 'length', asSampleCount);
  const preRoll = required(reading, object, at, 'preRoll', asSampleCount);
  const postRoll = required(reading, object, at, 'postRoll', asSampleCount);
  const crossfade = required(reading, object, at, 'crossfade', readCrossfade);
  const resampler = required(reading, object, at, 'resampler', asResamplerVersion);
  return length === undefined ||
    preRoll === undefined ||
    postRoll === undefined ||
    crossfade === undefined ||
    resampler === undefined
    ? undefined
    : { length, preRoll, postRoll, crossfade, resampler };
};

const asTakes = listConverter(MAXIMUM_NESTED_ITEMS, readTake);

/** Reads one take stack. */
export const readTakeStack: Converter<TakeStack> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, STACK_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asId<'TakeStackId'>);
  const name = required(reading, object, at, 'name', asTakeStackName);
  const takes = required(reading, object, at, 'takes', asTakes);
  const chosen = optional(reading, object, at, 'chosen', asId<'TakeId'>);
  const punch = optional(reading, object, at, 'punch', readPunchRange);
  return id === undefined || name === undefined || takes === undefined
    ? undefined
    : {
        id,
        name,
        takes,
        ...(chosen === undefined ? {} : { chosen }),
        ...(punch === undefined ? {} : { punch }),
      };
};

/**
 * A converter that reads a take stack of a project and checks it against the
 * project's `assets` by the domain's rule, refusing one that does not hold.
 */
export function takeStackConverter(
  assets: ReadonlyMap<AssetId, Asset> | undefined,
): Converter<TakeStack> {
  return (reading, value, parent, key) => {
    const stack = readTakeStack(reading, value, parent, key);
    if (stack === undefined || assets === undefined) return stack;
    const checked = validateTakeStack(stack, assets);
    refuseFailed(reading, checked, 'project.take-stack-invalid', pathOf(parent, key));
    return stack;
  };
}
