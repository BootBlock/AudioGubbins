/**
 * Reading the slot commands' arguments (ADR-0060): the slot a command names,
 * found among the project's chains, a place in a chain, and a control of a
 * slot with its value, each refused with a stable code and a reason. Read
 * rather than trusted, since a journal or a macro can carry any value.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  SummingLaw,
  fail,
  failure,
  findSlot,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type ChainSlot,
  type DomainResult,
  type EffectChain,
  type SlotPlace,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

import { optionalTextArgument, textArgument } from '../invocation-arguments.js';

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** A control of a slot and the value it is set to. */
export type SlotControl =
  | { readonly control: 'enabled' | 'soloed'; readonly value: boolean }
  | { readonly control: 'mix'; readonly value: number }
  | { readonly control: 'summing'; readonly value: SummingLaw };

/** A slot of the project and the chain that holds it. */
export interface HeldSlot {
  readonly chain: EffectChain;
  readonly slot: ChainSlot;
  readonly place: SlotPlace;
}

/** The slot `id` among the project's chains, with its chain and place, or `undefined`. */
export function slotIn(state: ProjectState, id: string): HeldSlot | undefined {
  for (const chain of state.project.effectChains.values()) {
    const found = findSlot(chain, id);
    if (found !== undefined) return { chain, ...found };
  }
  return undefined;
}

/** The slot the argument `slotId` names. */
export function namedSlot(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<HeldSlot> {
  const text = textArgument(invocation, 'slotId');
  if (!text.ok) return text;
  const found = isWellFormedId(text.value) ? slotIn(state, text.value) : undefined;
  return found === undefined
    ? rejected('slot.unknown', 'The project has no processor or group with that identifier.')
    : succeed(found);
}

/** A whole number argument from zero, or why it is not one. */
function countArgument(invocation: CommandInvocation, name: string): DomainResult<number> {
  const value = invocation.arguments?.[name];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? succeed(value)
    : rejected('slot.place-malformed', `The ${name} of a place is a whole number from zero.`);
}

/** The place the arguments `group`, `branch` and `index` state. */
export function placeArgument(invocation: CommandInvocation): DomainResult<SlotPlace> {
  const index = countArgument(invocation, 'index');
  if (!index.ok) return index;
  const group = optionalTextArgument(invocation, 'group');
  if (!group.ok) return group;
  if (group.value === undefined) {
    return invocation.arguments?.['branch'] === undefined
      ? succeed({ index: index.value })
      : rejected('slot.place-malformed', 'A branch is a branch of a group, which is not named.');
  }
  const branch = countArgument(invocation, 'branch');
  if (!branch.ok) return branch;
  if (!isWellFormedId(group.value)) {
    return rejected('slot.place-malformed', 'The group identifier is not one AudioGubbins makes.');
  }
  return succeed({
    group: { id: unsafeBrandId<'ProcessorGroupId'>(group.value), branch: branch.value },
    index: index.value,
  });
}

/** Whether `text` is a summing law. */
function isLaw(text: unknown): text is SummingLaw {
  return Object.values(SummingLaw).some((law) => law === text);
}

/** The control the arguments `control` and `value` set, or why they set none. */
export function controlArgument(invocation: CommandInvocation): DomainResult<SlotControl> {
  const control = invocation.arguments?.['control'];
  const value = invocation.arguments?.['value'];
  switch (control) {
    case 'enabled':
    case 'soloed':
      return typeof value === 'boolean'
        ? succeed({ control, value })
        : rejected('slot.control-malformed', `Whether a slot is ${control} is true or false.`);
    case 'mix':
      return typeof value === 'number'
        ? succeed({ control, value })
        : rejected('slot.control-malformed', 'A slot’s mix is a number.');
    case 'summing':
      return isLaw(value)
        ? succeed({ control, value })
        : rejected(
            'slot.control-malformed',
            'A group adds its branches by sum, mean or equal power.',
          );
    default:
      return rejected(
        'slot.control-unknown',
        'A slot’s controls are enabled, soloed, mix and summing.',
      );
  }
}
