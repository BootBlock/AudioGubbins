/**
 * Writing an effect chain as `chain-reading.ts` reads it.
 *
 * A chain has one persisted form (ADR-0060): the same object in a project
 * document, in the plan a paste carries, in the person's library of saved
 * chains and presets, and on the clipboard. Every member of every slot is
 * written, an optional one left out where it is absent, and a processor's
 * values in the order of their parameter identifiers, so one chain is always
 * one text.
 */

import type {
  ChainSlot,
  EffectChain,
  ModelIdentity,
  ProcessorInstance,
  ProcessorState,
  ProcessorStateVersion,
} from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import { presentMembers, sortedBy } from './document-writing.js';

function writeModel(model: ModelIdentity): JsonObject {
  return {
    pack: model.pack,
    version: model.version,
    modelHash: model.modelHash,
    runtimeHash: model.runtimeHash,
  };
}

function writeVersion(version: ProcessorStateVersion): JsonObject {
  return presentMembers({
    implementation: version.implementation,
    parameters: version.parameters,
    resampler: version.resampler,
    model: version.model === undefined ? undefined : writeModel(version.model),
  });
}

function writeState(state: ProcessorState): JsonObject {
  return { kind: state.kind, values: [...state.values] };
}

/** Writes one processor of a chain, its values in the order of their parameters. */
export function writeProcessor(processor: ProcessorInstance): JsonObject {
  return presentMembers({
    kind: 'processor',
    id: processor.id,
    typeKey: processor.typeKey,
    enabled: processor.enabled,
    soloed: processor.soloed,
    mix: processor.mix,
    version: writeVersion(processor.version),
    values: sortedBy(
      processor.values,
      ([parameter]) => parameter,
      ([parameter, value]) => ({ parameter, value }),
    ),
    state: processor.state === undefined ? undefined : writeState(processor.state),
  });
}

/** Writes one slot of a chain: a processor, or a group and every slot inside it. */
export function writeSlot(slot: ChainSlot): JsonObject {
  if (slot.kind === 'processor') return writeProcessor(slot);
  return {
    kind: 'group',
    id: slot.id,
    enabled: slot.enabled,
    soloed: slot.soloed,
    mix: slot.mix,
    summing: slot.summing,
    branches: slot.branches.map((branch) => ({ slots: branch.slots.map(writeSlot) })),
  };
}

/** Writes a chain, its slots in signal order, which is their meaning. */
export function writeEffectChain(chain: EffectChain): JsonObject {
  return { id: chain.id, slots: chain.slots.map(writeSlot) };
}
