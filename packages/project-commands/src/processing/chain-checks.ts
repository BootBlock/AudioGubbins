/**
 * What the chain commands check of the project's chains (ADR-0060): that a
 * slot's identifier names one slot in the whole project.
 *
 * Whether a chain can run where it is named is not checked here. A plan the
 * processor types refuse, for a type this build lacks, a layout a processor
 * does not take or a range's chain that changes its layout, makes the entry
 * unavailable with the reason when it is heard, and that is a state a project
 * may be in: a document from another build may hold one. A command that
 * refused it could not be undone, since the undo of taking such a rack away
 * is putting it back.
 */

import type { EffectChain } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

/** The identifier of every slot of `slots`, processors and groups, however deep. */
function slotIdentifiers(slots: EffectChain['slots'], into = new Set<string>()): Set<string> {
  for (const slot of slots) {
    into.add(slot.id);
    if (slot.kind === 'group')
      for (const branch of slot.branches) slotIdentifiers(branch.slots, into);
  }
  return into;
}

/**
 * Whether `chain` shares a slot's identifier with another chain of the
 * project: an identifier names one processor or group in the whole project.
 */
export function sharesIdentifiers(state: ProjectState, chain: EffectChain): boolean {
  const own = slotIdentifiers(chain.slots);
  for (const other of state.project.effectChains.values()) {
    if (other.id === chain.id) continue;
    for (const id of slotIdentifiers(other.slots)) if (own.has(id)) return true;
  }
  return false;
}
