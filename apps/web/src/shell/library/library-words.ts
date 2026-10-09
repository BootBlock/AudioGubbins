/**
 * What the Library panel says of a saved chain or preset: what it holds, in
 * signal order, by the labels the processor catalogue gives, with a parallel
 * group's branches named in order and how it adds them, and a processor or
 * group that is bypassed, soloed or mixed with its input said to be, since
 * that is part of what was saved.
 */

import type { ChainSlot, ProcessorInstance } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { counted } from '@audiogubbins/text';

import { LAW_NAMES } from '../../commands/rack-arguments.js';

/** How a slot's switches and mix set it apart, in a parenthesis, or nothing where they do not. */
function controlWords(slot: ChainSlot): string {
  const said = [
    ...(slot.enabled ? [] : ['bypassed']),
    ...(slot.soloed ? ['soloed'] : []),
    ...(slot.mix === 1 ? [] : [`mixed at ${String(Math.round(slot.mix * 100))}%`]),
  ];
  return said.length === 0 ? '' : ` (${said.join(', ')})`;
}

/** A processor by its label, or its type's key where this build does not know the type. */
export function processorWords(processor: ProcessorInstance): string {
  const label = PROCESSOR_CATALOGUE.get(processor.typeKey)?.label ?? processor.typeKey;
  return `${label}${controlWords(processor)}`;
}

/** One slot of a chain, a processor or a parallel group, in words. */
function slotWords(slot: ChainSlot): string {
  if (slot.kind === 'processor') return processorWords(slot);
  const branches = slot.branches.map((branch) =>
    branch.slots.length === 0 ? 'the input as it is' : slotsWords(branch.slots),
  );
  const law = LAW_NAMES[slot.summing].toLowerCase();
  return `${counted(slot.branches.length, 'parallel branch', 'parallel branches')} added by ${law} (${branches.join('; ')})${controlWords(slot)}`;
}

/** The slots of a chain or a branch, in signal order: "Gain, then Compressor". */
export function slotsWords(slots: readonly ChainSlot[]): string {
  return slots.length === 0 ? 'nothing' : slots.map(slotWords).join(', then ');
}
