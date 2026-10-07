/**
 * How the rack commands change the project (ADR-0060): every change through
 * the project's own chain and processor commands, as one step one undo
 * reverses, so a change to a chain several targets name reaches all of them
 * in that step, which is what a shared chain is (REQ-EDIT-014).
 *
 * A processor alone is set by the command that sets one processor, which
 * keeps a change made meanwhile to another slot of its chain; a change to a
 * group, or several slots of one chain at once with a group among them, sets
 * the chain whole, so no command of the step undoes another's.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  findSlot,
  withSlotReplaced,
  type ChainSlot,
  type EffectChain,
  type EffectChainId,
} from '@audiogubbins/domain';
import { setChainInvocation, setProcessorInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { changeProject } from './project-edits.js';
import { sessionOf } from './project-access.js';
import type { ShellContext } from './shell-context.js';

/** The invocations that give each slot of `changed` its new value, wherever its chain is. */
export function slotInvocations(
  state: ProjectState,
  changed: readonly ChainSlot[],
): readonly CommandInvocation[] {
  const byChain = new Map<EffectChainId, { chain: EffectChain; slots: ChainSlot[] }>();
  for (const slot of changed) {
    for (const chain of state.project.effectChains.values()) {
      if (findSlot(chain, slot.id) === undefined) continue;
      const held = byChain.get(chain.id) ?? { chain, slots: [] };
      held.slots.push(slot);
      byChain.set(chain.id, held);
    }
  }
  const invocations: CommandInvocation[] = [];
  for (const { chain, slots } of byChain.values()) {
    if (slots.every((slot) => slot.kind === 'processor')) {
      for (const slot of slots) invocations.push(setProcessorInvocation(slot));
      continue;
    }
    const whole = slots.reduce<EffectChain>(
      (changing, slot) => withSlotReplaced(changing, slot) ?? changing,
      chain,
    );
    invocations.push(setChainInvocation(whole));
  }
  return invocations;
}

/**
 * Makes `invocations` on the open project as one change called `description`,
 * saying `said` once it is made, or why it was not; or answers why there is
 * no project to change, or nothing to do.
 */
export function changeRacks(
  context: ShellContext,
  change: {
    readonly description: string;
    readonly invocations: readonly CommandInvocation[];
    readonly said: string;
  },
): string | undefined {
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  const [first, ...rest] = change.invocations;
  if (first === undefined) return 'There is nothing to change.';
  changeProject(context, session, { ...change, invocations: [first, ...rest] });
  return undefined;
}
