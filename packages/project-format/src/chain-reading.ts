/**
 * Reading an effect chain in its one persisted form (ADR-0060,
 * REQ-EXEC-136.12): in a project document, in a plan a paste carries, in the
 * person's library and on the clipboard.
 *
 * A processor's values are read as values a parameter may hold: a finite
 * number, a choice's key or a toggle. Whether each suits its parameter, and
 * whether this build has the processor type and the versions it was saved
 * with, is the processor catalogue's question, which the project's opening
 * and every command ask (`chainOutputLayout`); descriptors belong to the
 * build, not the file. A value is never clamped or repaired here. The
 * chain's shape, its bounds and the uniqueness of its slots are the domain's
 * `validateChainShape`, run on every chain read.
 */

import {
  MAXIMUM_GROUP_DEPTH,
  MAXIMUM_STATE_VALUES,
  SummingLaw,
  validateChainShape,
  type ChainSlot,
  type EffectChain,
  type ModelIdentity,
  type ParameterId,
  type ParameterValue,
  type ProcessorInstance,
  type ProcessorState,
  type ProcessorStateVersion,
} from '@audiogubbins/domain';

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  listConverter,
  listOf,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import {
  asBoolean,
  asId,
  integerConverter,
  numberConverter,
  oneOfConverter,
} from './scalar-reading.js';
import { MAXIMUM_NESTED_ITEMS, NAME_RULE, asKey } from './value-reading.js';

/**
 * How many levels of arrays and objects a written chain takes, its own object
 * the first: its list of slots and a slot in it; a group's branches, a branch
 * and its list and a slot in that, for each group as deep as groups nest; and
 * a processor's version and model, or its values and one value, inside the
 * deepest slot. A document holding a chain is read within its own depth at
 * the chain plus this, or a chain the domain accepts could not be kept.
 */
export const WRITTEN_CHAIN_DEPTH = 3 + 4 * MAXIMUM_GROUP_DEPTH + 2;

const CHAIN_MEMBERS: ReadonlySet<string> = new Set(['id', 'slots']);
const PROCESSOR_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'id',
  'typeKey',
  'enabled',
  'soloed',
  'mix',
  'version',
  'values',
  'state',
]);
const GROUP_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'id',
  'enabled',
  'soloed',
  'mix',
  'summing',
  'branches',
]);
const BRANCH_MEMBERS: ReadonlySet<string> = new Set(['slots']);
const VERSION_MEMBERS: ReadonlySet<string> = new Set([
  'implementation',
  'parameters',
  'resampler',
  'model',
]);
const MODEL_MEMBERS: ReadonlySet<string> = new Set(['pack', 'version', 'modelHash', 'runtimeHash']);
const STATE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'values']);
const VALUE_MEMBERS: ReadonlySet<string> = new Set(['parameter', 'value']);

const asSlotKind = oneOfConverter(['processor', 'group'] as const);
const asSummingLaw = oneOfConverter(Object.values(SummingLaw));
const asMix = numberConverter(0, 1);
const asVersionNumber = integerConverter(0, 1_000_000);
const asStateValue = numberConverter(-Number.MAX_VALUE, Number.MAX_VALUE);
const asStateValues = listConverter(MAXIMUM_STATE_VALUES, asStateValue);

const readModel: Converter<ModelIdentity> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, MODEL_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const pack = required(reading, object, at, 'pack', asKey);
  const version = required(reading, object, at, 'version', asKey);
  const modelHash = required(reading, object, at, 'modelHash', asKey);
  const runtimeHash = required(reading, object, at, 'runtimeHash', asKey);
  return pack === undefined ||
    version === undefined ||
    modelHash === undefined ||
    runtimeHash === undefined
    ? undefined
    : { pack, version, modelHash, runtimeHash };
};

const readVersion: Converter<ProcessorStateVersion> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, VERSION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const implementation = required(reading, object, at, 'implementation', asVersionNumber);
  const parameters = required(reading, object, at, 'parameters', asVersionNumber);
  const resampler = optional(reading, object, at, 'resampler', asVersionNumber);
  const model = optional(reading, object, at, 'model', readModel);
  return implementation === undefined || parameters === undefined
    ? undefined
    : {
        implementation,
        parameters,
        ...(resampler === undefined ? {} : { resampler }),
        ...(model === undefined ? {} : { model }),
      };
};

const readState: Converter<ProcessorState> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, STATE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asKey);
  const values = required(reading, object, at, 'values', asStateValues);
  return kind === undefined || values === undefined ? undefined : { kind, values };
};

/** Reads a value a parameter may hold. */
const asParameterValue: Converter<ParameterValue> = (reading, value, parent, key) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= NAME_RULE.maximumLength) return value;
  reading.refuse(
    'schema.unknown-value',
    'A parameter value is a finite number, a choice key of bounded length, or true or false.',
    pathOf(parent, key),
  );
  return undefined;
};

/** Reads a processor's values, written as a list of parameter and value. */
function readValues(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
): ReadonlyMap<ParameterId, ParameterValue> | undefined {
  const list = listOf(reading, value, parent, key, MAXIMUM_NESTED_ITEMS);
  if (list === undefined) return undefined;
  const at = pathOf(parent, key);
  const values = new Map<ParameterId, ParameterValue>();
  let whole = true;
  for (const [index, item] of list.entries()) {
    const object = objectOf(reading, item, at, index, VALUE_MEMBERS);
    const itemAt = pathOf(at, index);
    const parameter =
      object === undefined
        ? undefined
        : required(reading, object, itemAt, 'parameter', asId<'ParameterId'>);
    const parameterValue =
      object === undefined
        ? undefined
        : required(reading, object, itemAt, 'value', asParameterValue);
    if (parameter === undefined || parameterValue === undefined) {
      whole = false;
    } else if (values.has(parameter)) {
      reading.refuse(
        'project.duplicate-parameter',
        'The processor holds two values for one parameter.',
        pathOf(itemAt, 'parameter'),
      );
      whole = false;
    } else {
      values.set(parameter, parameterValue);
    }
  }
  return whole ? values : undefined;
}

/** The slots of a document read so far, so an identifier is refused the second time. */
export type SlotIdentifiers = Set<string>;

/** Reads one processor of a chain. */
function readProcessor(
  reading: Reading,
  object: JsonObject,
  at: string,
): ProcessorInstance | undefined {
  checkMembers(reading, object, at, PROCESSOR_MEMBERS);
  const id = required(reading, object, at, 'id', asId<'ProcessorId'>);
  const typeKey = required(reading, object, at, 'typeKey', asKey);
  const enabled = required(reading, object, at, 'enabled', asBoolean);
  const soloed = required(reading, object, at, 'soloed', asBoolean);
  const mix = required(reading, object, at, 'mix', asMix);
  const version = required(reading, object, at, 'version', readVersion);
  const values = required(reading, object, at, 'values', readValues);
  const state = optional(reading, object, at, 'state', readState);
  if (
    id === undefined ||
    typeKey === undefined ||
    enabled === undefined ||
    soloed === undefined ||
    mix === undefined ||
    version === undefined ||
    values === undefined
  ) {
    return undefined;
  }
  return {
    kind: 'processor',
    id,
    typeKey,
    enabled,
    soloed,
    mix,
    version,
    values,
    ...(state === undefined ? {} : { state }),
  };
}

/** Reads one slot, refusing an identifier `identifiers` already holds. */
function slotConverter(identifiers: SlotIdentifiers, depth: number): Converter<ChainSlot> {
  return (reading, value, parent, key) => {
    const object = anyObjectOf(reading, value, parent, key);
    if (object === undefined) return undefined;
    const at = pathOf(parent, key);
    const kind = required(reading, object, at, 'kind', asSlotKind);
    let slot: ChainSlot | undefined;
    if (kind === 'processor') slot = readProcessor(reading, object, at);
    else if (kind === 'group') slot = readGroup(reading, object, at, identifiers, depth);
    if (slot === undefined) return undefined;
    if (identifiers.has(slot.id)) {
      reading.refuse(
        'project.duplicate-processor',
        'Another processor or group in the project has the same identifier.',
        pathOf(at, 'id'),
      );
      return undefined;
    }
    identifiers.add(slot.id);
    return slot;
  };
}

/** Reads slots, refusing a group nested past the domain's bound before reading into it. */
function slotsConverter(
  identifiers: SlotIdentifiers,
  depth: number,
): Converter<readonly ChainSlot[]> {
  return listConverter(MAXIMUM_NESTED_ITEMS, slotConverter(identifiers, depth));
}

function readGroup(
  reading: Reading,
  object: JsonObject,
  at: string,
  identifiers: SlotIdentifiers,
  depth: number,
): ChainSlot | undefined {
  checkMembers(reading, object, at, GROUP_MEMBERS);
  if (depth >= MAXIMUM_GROUP_DEPTH) {
    reading.refuse(
      'effect-chain.too-deep',
      `Groups of processors nest at most ${String(MAXIMUM_GROUP_DEPTH)} deep.`,
      at,
    );
    return undefined;
  }
  const inner = slotsConverter(identifiers, depth + 1);
  const readBranch: Converter<readonly ChainSlot[]> = (branchReading, value, parent, key) => {
    const branch = objectOf(branchReading, value, parent, key, BRANCH_MEMBERS);
    return branch === undefined
      ? undefined
      : required(branchReading, branch, pathOf(parent, key), 'slots', inner);
  };
  const id = required(reading, object, at, 'id', asId<'ProcessorGroupId'>);
  const enabled = required(reading, object, at, 'enabled', asBoolean);
  const soloed = required(reading, object, at, 'soloed', asBoolean);
  const mix = required(reading, object, at, 'mix', asMix);
  const summing = required(reading, object, at, 'summing', asSummingLaw);
  const branches = required(
    reading,
    object,
    at,
    'branches',
    listConverter(MAXIMUM_NESTED_ITEMS, readBranch),
  );
  return id === undefined ||
    enabled === undefined ||
    soloed === undefined ||
    mix === undefined ||
    summing === undefined ||
    branches === undefined
    ? undefined
    : {
        kind: 'group',
        id,
        enabled,
        soloed,
        mix,
        summing,
        branches: branches.map((slots) => ({ slots })),
      };
}

/**
 * A converter reading one effect chain. `identifiers` holds every slot read
 * so far that the chain's slots may not share: for a project's own chains,
 * those of the whole project, since a processor's identifier names it across
 * the project; for a chain a paste or a library carries, a set of its own.
 */
export function effectChainConverter(identifiers: SlotIdentifiers): Converter<EffectChain> {
  const asSlots = slotsConverter(identifiers, 0);
  return (reading, value, parent, key) => {
    const object = objectOf(reading, value, parent, key, CHAIN_MEMBERS);
    if (object === undefined) return undefined;
    const at = pathOf(parent, key);
    const id = required(reading, object, at, 'id', asId<'EffectChainId'>);
    const slots = required(reading, object, at, 'slots', asSlots);
    if (id === undefined || slots === undefined) return undefined;
    const chain = validateChainShape({ id, slots });
    if (chain.ok) return chain.value;
    reading.refuseAll(chain.failures, at);
    return undefined;
  };
}

/** Reads a chain that keeps its own slot identifiers: a paste's, a library's, a clipboard's. */
export const readEffectChain: Converter<EffectChain> = (reading, value, parent, key) =>
  effectChainConverter(new Set())(reading, value, parent, key);

/** Reads one slot that keeps its own identifiers: a preset's processor, or a slot on the clipboard. */
export const readSlotAlone: Converter<ChainSlot> = (reading, value, parent, key) =>
  slotConverter(new Set(), 0)(reading, value, parent, key);
