/**
 * A chain read back from a value that crossed a thread.
 *
 * A processed stream carries its chain to the feeder, render and peak workers
 * as a structured clone (ADR-0052, ADR-0060), and a worker trusts no message,
 * so each member's type is checked here before the chain's shape is checked
 * by `validateChainShape`. The project document reads chains from its own
 * JSON with its own reader; this one reads the in-memory form a clone gives,
 * whose parameter values are still a `Map`.
 */

import { isWellFormedId, unsafeBrandId, type ParameterId } from '../identity/branded-id.js';
import { FailureKind, fail, failure, type DomainResult } from '../result.js';
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

type Fields = Readonly<Record<string, unknown>>;

/** Why a value is not a chain: the first thing found wrong. */
class Unreadable extends Error {}

const LAWS: ReadonlySet<string> = new Set(Object.values(SummingLaw));

/** The most parameter values one processor may hold. */
const MAXIMUM_VALUES = 1_024;

function fields(value: unknown, what: string): Fields {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  throw new Unreadable(what);
}

function list(value: unknown, what: string): readonly unknown[] {
  if (Array.isArray(value)) return value.map((item: unknown) => item);
  throw new Unreadable(what);
}

function text(value: unknown, what: string): string {
  if (typeof value === 'string' && value.length > 0 && value.length <= 256) return value;
  throw new Unreadable(what);
}

function flag(value: unknown, what: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Unreadable(what);
}

function finite(value: unknown, what: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Unreadable(what);
}

function whole(value: unknown, what: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Unreadable(what);
}

function identifier<T extends string>(
  value: unknown,
  what: string,
): ReturnType<typeof unsafeBrandId<T>> {
  if (typeof value === 'string' && isWellFormedId(value)) return unsafeBrandId<T>(value);
  throw new Unreadable(what);
}

function modelOf(value: unknown): ModelIdentity {
  const read = fields(value, 'a model');
  return {
    pack: text(read['pack'], 'a model’s pack'),
    version: text(read['version'], 'a model’s version'),
    modelHash: text(read['modelHash'], 'a model’s hash'),
    runtimeHash: text(read['runtimeHash'], 'a runtime’s hash'),
  };
}

function versionOf(value: unknown): ProcessorStateVersion {
  const read = fields(value, 'a processor’s version');
  return {
    implementation: whole(read['implementation'], 'an implementation version'),
    parameters: whole(read['parameters'], 'a parameter schema version'),
    ...(read['resampler'] === undefined
      ? {}
      : { resampler: whole(read['resampler'], 'a resampler version') }),
    ...(read['model'] === undefined ? {} : { model: modelOf(read['model']) }),
  };
}

function isParameterValue(value: unknown): value is ParameterValue {
  return typeof value === 'number'
    ? Number.isFinite(value)
    : typeof value === 'string' || typeof value === 'boolean';
}

function valuesOf(value: unknown): ReadonlyMap<ParameterId, ParameterValue> {
  if (!(value instanceof Map) || value.size > MAXIMUM_VALUES) {
    throw new Unreadable('a processor’s values');
  }
  const values = new Map<ParameterId, ParameterValue>();
  for (const [key, entry] of value.entries()) {
    if (!isParameterValue(entry)) throw new Unreadable('a parameter value');
    values.set(identifier<'ParameterId'>(key, 'a parameter'), entry);
  }
  return values;
}

function stateOf(value: unknown): ProcessorState {
  const read = fields(value, 'a processor’s state');
  return {
    kind: text(read['kind'], 'a state’s kind'),
    values: list(read['values'], 'a state’s values').map((entry) => finite(entry, 'a state value')),
  };
}

function processorOf(read: Fields): ProcessorInstance {
  const state = read['state'] === undefined ? undefined : stateOf(read['state']);
  return {
    kind: 'processor',
    id: identifier<'ProcessorId'>(read['id'], 'a processor’s identifier'),
    typeKey: text(read['typeKey'], 'a processor’s type'),
    enabled: flag(read['enabled'], 'a slot’s bypass'),
    soloed: flag(read['soloed'], 'a slot’s solo'),
    mix: finite(read['mix'], 'a slot’s mix'),
    version: versionOf(read['version']),
    values: valuesOf(read['values']),
    ...(state === undefined ? {} : { state }),
  };
}

function isSummingLaw(value: unknown): value is SummingLaw {
  return typeof value === 'string' && LAWS.has(value);
}

/** Reads slots no deeper than groups may nest and no more than a chain holds. */
class SlotReader {
  #slots = 0;

  slots(value: unknown, depth: number): readonly ChainSlot[] {
    return list(value, 'a list of slots').map((slot) => this.#slot(slot, depth));
  }

  #slot(value: unknown, depth: number): ChainSlot {
    this.#slots += 1;
    if (this.#slots > MAXIMUM_CHAIN_SLOTS) throw new Unreadable('a chain of a size any chain has');
    const read = fields(value, 'a slot');
    if (read['kind'] === 'processor') return processorOf(read);
    const summing = read['summing'];
    if (read['kind'] !== 'group' || !isSummingLaw(summing)) throw new Unreadable('a slot');
    if (depth >= MAXIMUM_GROUP_DEPTH)
      throw new Unreadable('a chain whose groups nest within bounds');
    return {
      kind: 'group',
      id: identifier<'ProcessorGroupId'>(read['id'], 'a group’s identifier'),
      enabled: flag(read['enabled'], 'a slot’s bypass'),
      soloed: flag(read['soloed'], 'a slot’s solo'),
      mix: finite(read['mix'], 'a slot’s mix'),
      summing,
      branches: list(read['branches'], 'a group’s branches').map((branch): ChainBranch => ({
        slots: this.slots(fields(branch, 'a branch')['slots'], depth + 1),
      })),
    };
  }
}

/** The chain `value` holds, whole, or why it holds none. */
export function effectChainFrom(value: unknown): DomainResult<EffectChain> {
  try {
    const read = fields(value, 'a chain');
    return validateChainShape({
      id: identifier<'EffectChainId'>(read['id'], 'a chain’s identifier'),
      slots: new SlotReader().slots(read['slots'], 0),
    });
  } catch (problem) {
    // Only the reader's own refusal is expected here; anything else is a fault.
    if (!(problem instanceof Unreadable)) throw problem;
    return fail(
      failure(
        'effect-chain.unreadable',
        FailureKind.Rejected,
        `A chain that crossed a thread is not ${problem.message}.`,
      ),
    );
  }
}
