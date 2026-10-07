/**
 * What the Library panel says of a saved chain or preset: what it holds, in
 * signal order, by the labels the processor catalogue gives, with a parallel
 * group's branches named in order and a processor that is bypassed or soloed
 * said to be, since that is part of what was saved.
 */

import type { ChainSlot, ProcessorInstance } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { counted } from '@audiogubbins/text';

/** A processor by its label, or its type's key where this build does not know the type. */
export function processorWords(processor: ProcessorInstance): string {
  const label = PROCESSOR_CATALOGUE.get(processor.typeKey)?.label ?? processor.typeKey;
  if (!processor.enabled) return `${label} (bypassed)`;
  return processor.soloed ? `${label} (soloed)` : label;
}

/** One slot of a chain, a processor or a parallel group, in words. */
function slotWords(slot: ChainSlot): string {
  if (slot.kind === 'processor') return processorWords(slot);
  const branches = slot.branches.map((branch) =>
    branch.slots.length === 0 ? 'the input as it is' : slotsWords(branch.slots),
  );
  const group = `${counted(slot.branches.length, 'parallel branch', 'parallel branches')} (${branches.join('; ')})`;
  return slot.enabled ? group : `${group} (bypassed)`;
}

/** The slots of a chain or a branch, in signal order: "Gain, then Compressor". */
export function slotsWords(slots: readonly ChainSlot[]): string {
  return slots.length === 0 ? 'nothing' : slots.map(slotWords).join(', then ');
}
