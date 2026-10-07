/**
 * What the rack commands read from their arguments, and how they speak of
 * what they change: a place in a chain, a summing law, an on or off, and a
 * slot's name. Read rather than trusted, since a macro, a script or a journal
 * can carry any value (REQ-EDIT-073).
 *
 * A place is `index` in the chain's own list, or in branch `branch` of the
 * group `group`; an index left out is the end of that list.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  SummingLaw,
  isWellFormedId,
  unsafeBrandId,
  type ChainSlot,
  type EffectChain,
  type SlotPlace,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { quoted } from '@audiogubbins/text';

import { textArgument } from './shell-command.js';

/** The slots of the list `place` names in `chain`, or `undefined` where it has no such list. */
export function listAt(
  chain: Pick<EffectChain, 'slots'>,
  group: SlotPlace['group'],
): readonly ChainSlot[] | undefined {
  if (group === undefined) return chain.slots;
  const search = (slots: readonly ChainSlot[]): readonly ChainSlot[] | undefined => {
    for (const slot of slots) {
      if (slot.kind !== 'group') continue;
      if (slot.id === group.id) return slot.branches[group.branch]?.slots;
      for (const branch of slot.branches) {
        const found = search(branch.slots);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return search(chain.slots);
}

/** A whole number argument at least zero, `undefined` where absent, or why it is not one. */
function countArgument(
  invocation: CommandInvocation,
  name: string,
): number | undefined | { readonly refused: string } {
  const value = invocation.arguments?.[name];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : { refused: `The ${name} is a whole number from zero.` };
}

/**
 * The place an invocation names in `chain`, by `group`, `branch` and
 * `index`, the end of the chain's own list where it names none; or why it
 * names no place in the chain.
 */
export function placeArgument(
  invocation: CommandInvocation,
  chain: Pick<EffectChain, 'slots'>,
): SlotPlace | string {
  const groupText = textArgument(invocation, 'group');
  const branch = countArgument(invocation, 'branch');
  const index = countArgument(invocation, 'index');
  if (typeof branch === 'object') return branch.refused;
  if (typeof index === 'object') return index.refused;
  if ((groupText === undefined) !== (branch === undefined)) {
    return 'A place in a group names the group and its branch.';
  }
  const group =
    groupText === undefined || branch === undefined
      ? undefined
      : isWellFormedId(groupText)
        ? { id: unsafeBrandId<'ProcessorGroupId'>(groupText), branch }
        : undefined;
  if (groupText !== undefined && group === undefined) return 'There is no such group.';
  const list = listAt(chain, group);
  if (list === undefined) return 'The rack has no such group or branch.';
  const at = index ?? list.length;
  if (at > list.length) return 'That is past the end of the list.';
  return group === undefined ? { index: at } : { group, index: at };
}

/** What each summing law is called. */
export const LAW_NAMES: Readonly<Record<SummingLaw, string>> = {
  [SummingLaw.Sum]: 'Sum',
  [SummingLaw.Mean]: 'Mean',
  [SummingLaw.EqualPower]: 'Equal power',
};

/** Whether `text` is a summing law. */
function isLaw(text: string): text is SummingLaw {
  return Object.values(SummingLaw).some((law) => law === text);
}

/** The summing law an invocation names by `law`, `fallback` where absent, or why it is none. */
export function lawArgument(
  invocation: CommandInvocation,
  fallback: SummingLaw | undefined,
): SummingLaw | { readonly refused: string } {
  const named = textArgument(invocation, 'law');
  if (named === undefined) {
    return (
      fallback ?? { refused: 'Say how the group adds its branches: sum, mean or equal power.' }
    );
  }
  return isLaw(named)
    ? named
    : { refused: 'A group adds its branches by sum, mean or equal power.' };
}

/** The on or off an invocation names by `name`, the opposite of `current` where absent. */
export function switchArgument(
  invocation: CommandInvocation,
  name: string,
  current: boolean,
): boolean | { readonly refused: string } {
  const value = invocation.arguments?.[name];
  if (value === undefined || value === null) return !current;
  return typeof value === 'boolean' ? value : { refused: `Say whether ${name} is on or off.` };
}

/** What a slot is called in a sentence: its processor's name, quoted, or a parallel group. */
export function slotName(slot: ChainSlot): string {
  if (slot.kind === 'group') return 'the parallel group';
  return quoted(PROCESSOR_CATALOGUE.get(slot.typeKey)?.label ?? slot.typeKey);
}
