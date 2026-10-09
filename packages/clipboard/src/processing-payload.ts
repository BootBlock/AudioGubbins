/**
 * Copying and pasting processing (ADR-0053 as amended by ADR-0060): a
 * processor, a group, several slots or a whole chain.
 *
 * The clipboard is one: audio and processing are two kinds of its payload,
 * and copying either takes the place of what was held. What is copied is held
 * as the chain's own values, the form the project keeps, and a paste copies
 * it again under new identifiers, so the slots pasted are never the slots
 * copied, and pasting twice makes two.
 */

import {
  FailureKind,
  copySlot,
  fail,
  failure,
  succeed,
  type ChainSlot,
  type DomainResult,
  type EffectChain,
  type IdGenerator,
} from '@audiogubbins/domain';

/** Slots copied from a rack, in signal order, and whether they were the whole chain. */
export interface ProcessingPayload {
  readonly kind: 'processing';
  readonly slots: readonly [ChainSlot, ...ChainSlot[]];
  readonly wholeChain: boolean;
}

/** A copy of `slots` for the clipboard, or why there is nothing to copy. */
export function copyProcessing(
  slots: readonly ChainSlot[],
  wholeChain: boolean,
): DomainResult<ProcessingPayload> {
  const [first, ...rest] = slots;
  return first === undefined
    ? fail(
        failure(
          'clipboard.nothing-to-copy',
          FailureKind.Rejected,
          'There is no processor to copy.',
        ),
      )
    : succeed({ kind: 'processing', slots: [first, ...rest], wholeChain });
}

/**
 * The copied slots as a paste places them, in their order, each a copy under
 * new identifiers, so the slots pasted are never the slots copied; where they
 * go in a rack is the rack's command's to check.
 */
export function pastedSlots(
  payload: ProcessingPayload,
  ids: IdGenerator,
): readonly [ChainSlot, ...ChainSlot[]] {
  const [first, ...rest] = payload.slots;
  return [copySlot(first, ids), ...rest.map((slot) => copySlot(slot, ids))];
}

/** A new chain of the copied slots, under new identifiers, for a target with no rack yet. */
export function chainFromProcessing(payload: ProcessingPayload, ids: IdGenerator): EffectChain {
  return { id: ids.next<'EffectChainId'>(), slots: pastedSlots(payload, ids) };
}
