/**
 * Where a workflow's processing goes (ADR-0101, ADR-0105): a member's own
 * rack, or the chain its group's members inherit.
 *
 * A member's rack is extended as applying an assistant's recommendation
 * extends one: the target is given a rack of its own, a copy of the one it
 * has with the processing at its end, so another target sharing that rack
 * hears no change; a member that inherited its group's processing owns it
 * from then on, which the person chose. A group's chain is changed where the
 * group sets it, slot by slot, for every member that inherits it; where it
 * inherits the chain from a group above, or has none, the group is given a
 * chain of its own, so groups beside it hear no change.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  copyChain,
  type ChainSlot,
  type EffectChain,
  type EffectChainId,
  type IdGenerator,
  type ProcessorCatalogue,
} from '@audiogubbins/domain';
import {
  groupPath,
  inheritingRacks,
  pathText,
  resolveGroupPolicy,
  type GameAssetGroupId,
} from '@audiogubbins/game-audio';
import {
  addSlotInvocation,
  setGroupPolicyInvocation,
  setProcessorInvocation,
  setRackInvocation,
} from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { chainEnding, type ChainProcessing, type SlotChange } from './chain-ending.js';
import { gameOf, type MemberSubject } from './workflow-subjects.js';

/** For a member that inherits its group's processing: change the group's chain, or give it its own. */
export type Placement = 'member' | 'group';

/** The invocations of one change of processing, and what each says. */
export interface ProcessingChange {
  readonly invocations: readonly CommandInvocation[];
  readonly changes: readonly string[];
}

const NO_CHANGE: ProcessingChange = { invocations: [], changes: [] };

function labelOf(typeKey: string, catalogue: ProcessorCatalogue): string {
  return (catalogue.get(typeKey)?.label ?? typeKey).toLowerCase();
}

function changeWords(change: SlotChange, where: string, catalogue: ProcessorCatalogue): string {
  const label = labelOf(change.processor.typeKey, catalogue);
  return change.kind === 'add' ? `Add ${label} to ${where}.` : `Set the ${label} of ${where} anew.`;
}

/** The chain `id` names, a fault where the project lacks it, which a valid state never does. */
function chainOf(state: ProjectState, id: EffectChainId): EffectChain {
  const chain = state.project.effectChains.get(id);
  if (chain === undefined) throw new Error(`The project has no chain ${id}.`);
  return chain;
}

/** `slots` under new identifiers, as a copy of a chain is made. */
function copiedSlots(slots: readonly ChainSlot[], id: EffectChainId, ids: IdGenerator) {
  return copyChain({ id, slots }, ids).slots;
}

/** How `subject`'s own rack comes to end with `processing`: a rack of its own, extended. */
export function memberRackChange(
  state: ProjectState,
  subject: MemberSubject,
  processing: ChainProcessing,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): ProcessingChange {
  const rackId = subject.rack.kind === 'asset' ? subject.rack.asset.rack : subject.rack.region.rack;
  const existing = rackId === undefined ? [] : chainOf(state, rackId).slots;
  const planned = chainEnding(existing, processing);
  if (planned.changes.length === 0) return NO_CHANGE;
  const id = ids.next<'EffectChainId'>();
  const kept = rackId === undefined ? [] : copiedSlots(existing, id, ids);
  const { slots } = chainEnding(kept, processing);
  const inherits = subject.membership?.processing === 'inherit';
  const where = `the rack of "${subject.name}"`;
  return {
    invocations: [setRackInvocation(subject.rack, { id, slots }, inherits ? 'own' : undefined)],
    changes: [
      ...(inherits
        ? [`Give "${subject.name}" processing of its own, a copy of its group's chain.`]
        : rackId === undefined
          ? []
          : [`Give "${subject.name}" a copy of its rack, so nothing sharing it changes.`]),
      ...planned.changes.map((change) => changeWords(change, where, catalogue)),
    ],
  };
}

/** How many members inherit `chain` as their rack. */
function inheritors(state: ProjectState, chain: EffectChainId): number {
  return inheritingRacks(gameOf(state)).filter((one) => one.rack === chain).length;
}

function heardBy(count: number): string {
  return count === 1 ? 'heard by 1 member' : `heard by ${String(count)} members`;
}

/**
 * How the chain `group`'s members inherit comes to end with `processing`:
 * changed in place where the group sets it; otherwise the group given its
 * own, a copy of what it inherits or, where it inherits none, of `base`
 * where given, ending with `processing`.
 */
export function groupChainChange(
  state: ProjectState,
  group: GameAssetGroupId,
  processing: ChainProcessing,
  base: (() => EffectChain | undefined) | undefined,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): ProcessingChange {
  const game = gameOf(state);
  const name = `"${pathText(groupPath(game.groups, group))}"`;
  const { value, source } = resolveGroupPolicy(game, group).fields.processing;
  const inherited = value === undefined || value === 'none' ? undefined : value;
  if (inherited !== undefined && source.kind === 'group' && source.group === group) {
    const { changes } = chainEnding(chainOf(state, inherited).slots, processing);
    const where = `the chain of ${name}, ${heardBy(inheritors(state, inherited))}`;
    return {
      invocations: changes.map((change) =>
        change.kind === 'add'
          ? addSlotInvocation(inherited, { index: change.index }, change.processor)
          : setProcessorInvocation(change.processor),
      ),
      changes: changes.map((change) => changeWords(change, where, catalogue)),
    };
  }
  if (
    inherited !== undefined &&
    chainEnding(chainOf(state, inherited).slots, processing).changes.length === 0
  ) {
    return NO_CHANGE;
  }
  const id = ids.next<'EffectChainId'>();
  const start =
    inherited === undefined
      ? (base?.()?.slots ?? [])
      : copiedSlots(chainOf(state, inherited).slots, id, ids);
  const { slots } = chainEnding(start, processing);
  if (slots.length === 0) return NO_CHANGE;
  const labels = slots
    .flatMap((slot) => (slot.kind === 'processor' ? [labelOf(slot.typeKey, catalogue)] : []))
    .join(', ');
  return {
    invocations: [setGroupPolicyInvocation(group, 'processing', id, { id, slots })],
    changes: [
      inherited === undefined
        ? `Give ${name} a chain of its own for its members to inherit: ${labels}.`
        : `Give ${name} a chain of its own, a copy of the one it inherits ending anew: ${labels}.`,
    ],
  };
}

/**
 * Where `processing` goes for `subject`: its group's chain where it inherits
 * its group's processing and `placement` asks for the group, else its own
 * rack.
 */
export function placedChange(
  state: ProjectState,
  subject: MemberSubject,
  processing: ChainProcessing,
  placement: Placement,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): ProcessingChange {
  const { membership } = subject;
  return membership?.processing === 'inherit' && placement === 'group'
    ? groupChainChange(state, membership.group, processing, undefined, catalogue, ids)
    : memberRackChange(state, subject, processing, catalogue, ids);
}
