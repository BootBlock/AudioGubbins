/**
 * Changing a chain as a value: placing, replacing, moving and removing a slot,
 * and copying slots under new identifiers.
 *
 * The rack's commands are built on these, so a slot inside a group is found
 * and changed by the same rule as one at the top of a chain, and a copy made
 * for the clipboard, a saved chain applied, or a shared chain made independent
 * all mint identifiers the same way (ADR-0060).
 */

import type { IdGenerator } from '../identity/id-generator.js';
import type { ProcessorGroupId } from '../identity/branded-id.js';
import type { ChainSlot, EffectChain } from './effect-chain.js';

/**
 * Where a slot sits: at `index` of the chain's own list, or of branch `branch`
 * of the group `group`.
 */
export interface SlotPlace {
  readonly group?: { readonly id: ProcessorGroupId; readonly branch: number };
  readonly index: number;
}

/** A slot found in a chain, and where. */
export interface FoundSlot {
  readonly slot: ChainSlot;
  readonly place: SlotPlace;
}

/** The slot `id` among `slots` and the branches inside them, and its place. */
function findIn(
  slots: readonly ChainSlot[],
  id: string,
  group: SlotPlace['group'],
): FoundSlot | undefined {
  for (const [index, slot] of slots.entries()) {
    if (slot.id === id) return { slot, place: group === undefined ? { index } : { group, index } };
    if (slot.kind !== 'group') continue;
    for (const [branch, { slots: inner }] of slot.branches.entries()) {
      const found = findIn(inner, id, { id: slot.id, branch });
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The slot `id` of the chain, and where it sits, or `undefined`. */
export function findSlot(chain: Pick<EffectChain, 'slots'>, id: string): FoundSlot | undefined {
  return findIn(chain.slots, id, undefined);
}

/** The slots of the list at `group` in `chain`, or `undefined` where it has no such list. */
export function slotsAt(
  chain: Pick<EffectChain, 'slots'>,
  group: SlotPlace['group'],
): readonly ChainSlot[] | undefined {
  if (group === undefined) return chain.slots;
  for (const slot of chain.slots) {
    if (slot.kind !== 'group') continue;
    if (slot.id === group.id) return slot.branches[group.branch]?.slots;
    for (const branch of slot.branches) {
      const found = slotsAt(branch, group);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * The slots with the list at `place`'s level changed by `change`, or
 * `undefined` where `place` names a group or branch the slots do not have.
 */
function changeList(
  slots: readonly ChainSlot[],
  group: SlotPlace['group'],
  change: (list: readonly ChainSlot[]) => readonly ChainSlot[] | undefined,
): readonly ChainSlot[] | undefined {
  if (group === undefined) return change(slots);
  for (const [index, slot] of slots.entries()) {
    if (slot.kind !== 'group') continue;
    for (const [place, branch] of slot.branches.entries()) {
      const inner =
        slot.id === group.id
          ? place === group.branch
            ? change(branch.slots)
            : undefined
          : changeList(branch.slots, group, change);
      if (inner !== undefined) {
        return slots.with(index, {
          ...slot,
          branches: slot.branches.with(place, { slots: inner }),
        });
      }
    }
  }
  return undefined;
}

/** The chain with `slot` placed at `place`, or `undefined` where there is no such place. */
export function withSlotAt<T extends Pick<EffectChain, 'slots'>>(
  chain: T,
  place: SlotPlace,
  slot: ChainSlot,
): T | undefined {
  const slots = changeList(chain.slots, place.group, (list) =>
    Number.isInteger(place.index) && place.index >= 0 && place.index <= list.length
      ? list.toSpliced(place.index, 0, slot)
      : undefined,
  );
  return slots === undefined ? undefined : { ...chain, slots };
}

/** The chain without the slot `id`, or `undefined` where it has none. */
export function withoutSlot<T extends Pick<EffectChain, 'slots'>>(
  chain: T,
  id: string,
): T | undefined {
  const found = findSlot(chain, id);
  if (found === undefined) return undefined;
  const slots = changeList(chain.slots, found.place.group, (list) =>
    list.toSpliced(found.place.index, 1),
  );
  return slots === undefined ? undefined : { ...chain, slots };
}

/** The chain with the slot of `slot`'s identifier replaced by it, or `undefined` where it has none. */
export function withSlotReplaced<T extends Pick<EffectChain, 'slots'>>(
  chain: T,
  slot: ChainSlot,
): T | undefined {
  const found = findSlot(chain, slot.id);
  if (found === undefined) return undefined;
  const slots = changeList(chain.slots, found.place.group, (list) =>
    list.with(found.place.index, slot),
  );
  return slots === undefined ? undefined : { ...chain, slots };
}

/**
 * The chain with the slot `id` moved to `place`, stated as the chain stands
 * without it, or `undefined` where either is not in the chain. A place inside
 * the moved group is not in the chain once the group is taken out of it.
 */
export function withSlotMoved<T extends Pick<EffectChain, 'slots'>>(
  chain: T,
  id: string,
  place: SlotPlace,
): T | undefined {
  const found = findSlot(chain, id);
  if (found === undefined) return undefined;
  const without = withoutSlot(chain, id);
  return without === undefined ? undefined : withSlotAt(without, place, found.slot);
}

/** A copy of `slot`, and of every slot inside it, under new identifiers. */
export function copySlot(slot: ChainSlot, ids: IdGenerator): ChainSlot {
  if (slot.kind === 'processor') return { ...slot, id: ids.next<'ProcessorId'>() };
  return {
    ...slot,
    id: ids.next<'ProcessorGroupId'>(),
    branches: slot.branches.map((branch) => ({
      slots: branch.slots.map((inner) => copySlot(inner, ids)),
    })),
  };
}

/** A copy of the chain under a new identifier, every slot under a new one too. */
export function copyChain(chain: EffectChain, ids: IdGenerator): EffectChain {
  return {
    id: ids.next<'EffectChainId'>(),
    slots: chain.slots.map((slot) => copySlot(slot, ids)),
  };
}
