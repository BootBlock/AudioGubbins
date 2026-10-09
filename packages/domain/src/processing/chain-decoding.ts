/**
 * A chain read back from a value that crossed a thread.
 *
 * A processed stream carries its chain to the feeder, render and peak workers
 * as a structured clone (ADR-0052, ADR-0060), and a worker trusts no message,
 * so each member's type is checked here, by the one reader of a message's
 * fields, before the chain's shape is checked by `validateChainShape`. The
 * project document reads chains from its own JSON with its own reader; this
 * one reads the in-memory form a clone gives, whose parameter values are
 * still a `Map`.
 */

import type { ParameterId } from '../identity/branded-id.js';
import {
  Malformed,
  boundedItemsOf,
  countOf,
  fieldsOf,
  flagOf,
  identifierOf,
  itemsOf,
  numberOf,
  textOf,
} from '../messages/message-fields.js';
import type { DomainResult } from '../result.js';
import {
  MAXIMUM_CHAIN_SLOTS,
  MAXIMUM_GROUP_DEPTH,
  validateChainShape,
} from './chain-validation.js';
import {
  SummingLaw,
  type ChainBranch,
  type ChainSlot,
  type EffectChain,
  type ProcessorInstance,
} from './effect-chain.js';
import type { ParameterValue } from './parameter.js';
import type { ModelIdentity, ProcessorState, ProcessorStateVersion } from './processor-version.js';

const LAWS: ReadonlySet<string> = new Set(Object.values(SummingLaw));

/** The most parameter values one processor may hold. */
const MAXIMUM_VALUES = 1_024;

/** The longest name a chain holds: a type key, a state's kind, a pack, a version or a hash. */
const MAXIMUM_NAME = 256;

/** The value, named `field`, as text of one to {@link MAXIMUM_NAME} characters. */
function nameOf(value: unknown, field: string): string {
  const text = textOf(value, field);
  if (text.length === 0 || text.length > MAXIMUM_NAME) {
    throw new Malformed(field, `text of 1 to ${String(MAXIMUM_NAME)} characters`);
  }
  return text;
}

function modelOf(value: unknown, field: string): ModelIdentity {
  const read = fieldsOf(value, field);
  return {
    pack: nameOf(read['pack'], `${field}.pack`),
    version: nameOf(read['version'], `${field}.version`),
    modelHash: nameOf(read['modelHash'], `${field}.modelHash`),
    runtimeHash: nameOf(read['runtimeHash'], `${field}.runtimeHash`),
  };
}

function versionOf(value: unknown, field: string): ProcessorStateVersion {
  const read = fieldsOf(value, field);
  const { resampler, model } = read;
  return {
    implementation: countOf(read['implementation'], `${field}.implementation`),
    parameters: countOf(read['parameters'], `${field}.parameters`),
    ...(resampler === undefined ? {} : { resampler: countOf(resampler, `${field}.resampler`) }),
    ...(model === undefined ? {} : { model: modelOf(model, `${field}.model`) }),
  };
}

function parameterValueOf(value: unknown, field: string): ParameterValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return numberOf(value, field);
}

function valuesOf(value: unknown, field: string): ReadonlyMap<ParameterId, ParameterValue> {
  if (!(value instanceof Map)) throw new Malformed(field, 'a map of parameter values');
  if (value.size > MAXIMUM_VALUES) {
    throw new Malformed(field, `a map of at most ${String(MAXIMUM_VALUES)} values`);
  }
  const values = new Map<ParameterId, ParameterValue>();
  for (const [key, entry] of value.entries()) {
    const name = `${field}.${String(key)}`;
    values.set(identifierOf<'ParameterId'>(key, name), parameterValueOf(entry, name));
  }
  return values;
}

function stateOf(value: unknown, field: string): ProcessorState {
  const read = fieldsOf(value, field);
  return {
    kind: nameOf(read['kind'], `${field}.kind`),
    values: itemsOf(read['values'], `${field}.values`, numberOf),
  };
}

function processorOf(read: Readonly<Record<string, unknown>>, field: string): ProcessorInstance {
  const { state } = read;
  return {
    kind: 'processor',
    id: identifierOf<'ProcessorId'>(read['id'], `${field}.id`),
    typeKey: nameOf(read['typeKey'], `${field}.typeKey`),
    enabled: flagOf(read['enabled'], `${field}.enabled`),
    soloed: flagOf(read['soloed'], `${field}.soloed`),
    mix: numberOf(read['mix'], `${field}.mix`),
    version: versionOf(read['version'], `${field}.version`),
    values: valuesOf(read['values'], `${field}.values`),
    ...(state === undefined ? {} : { state: stateOf(state, `${field}.state`) }),
  };
}

function lawOf(value: unknown, field: string): SummingLaw {
  const isLaw = (one: unknown): one is SummingLaw => typeof one === 'string' && LAWS.has(one);
  if (!isLaw(value)) throw new Malformed(field, `one of ${[...LAWS].join(', ')}`);
  return value;
}

/** Reads slots no deeper than groups may nest and no more than a chain holds. */
class SlotReader {
  #slots = 0;

  slots(value: unknown, field: string, depth: number): readonly ChainSlot[] {
    return boundedItemsOf(value, field, MAXIMUM_CHAIN_SLOTS, (slot, name) =>
      this.#slot(slot, name, depth),
    );
  }

  #slot(value: unknown, field: string, depth: number): ChainSlot {
    this.#slots += 1;
    if (this.#slots > MAXIMUM_CHAIN_SLOTS) {
      throw new Malformed(field, `in a chain of at most ${String(MAXIMUM_CHAIN_SLOTS)} slots`);
    }
    const read = fieldsOf(value, field);
    if (read['kind'] === 'processor') return processorOf(read, field);
    if (read['kind'] !== 'group') throw new Malformed(`${field}.kind`, 'processor or group');
    if (depth >= MAXIMUM_GROUP_DEPTH) {
      throw new Malformed(field, `a group nested at most ${String(MAXIMUM_GROUP_DEPTH)} deep`);
    }
    return {
      kind: 'group',
      id: identifierOf<'ProcessorGroupId'>(read['id'], `${field}.id`),
      enabled: flagOf(read['enabled'], `${field}.enabled`),
      soloed: flagOf(read['soloed'], `${field}.soloed`),
      mix: numberOf(read['mix'], `${field}.mix`),
      summing: lawOf(read['summing'], `${field}.summing`),
      branches: itemsOf(read['branches'], `${field}.branches`, (branch, name): ChainBranch => ({
        slots: this.slots(fieldsOf(branch, name)['slots'], `${name}.slots`, depth + 1),
      })),
    };
  }
}

/**
 * The chain `value` holds, named `field`, read member by member; a value that
 * is no chain throws {@link Malformed} at its first wrong member, and one
 * whose shape is wrong answers why.
 */
export function effectChainOf(value: unknown, field: string): DomainResult<EffectChain> {
  const read = fieldsOf(value, field);
  return validateChainShape({
    id: identifierOf<'EffectChainId'>(read['id'], `${field}.id`),
    slots: new SlotReader().slots(read['slots'], `${field}.slots`, 0),
  });
}
