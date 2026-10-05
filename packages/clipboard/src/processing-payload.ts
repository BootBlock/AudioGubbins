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
  withSlotAt,
  type ChainSlot,
  type DomainResult,
  type EffectChain,
  type IdGenerator,
  type SlotPlace,
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
 * The chain with the copied slots placed at `place`, in their order, each a
 * copy under new identifiers, or why `place` is not a place in the chain.
 */
export function pasteProcessing(
  payload: ProcessingPayload,
  chain: EffectChain,
  place: SlotPlace,
  ids: IdGenerator,
): DomainResult<EffectChain> {
  let pasted = chain;
  for (const [offset, slot] of payload.slots.entries()) {
    const next = withSlotAt(pasted, { ...place, index: place.index + offset }, copySlot(slot, ids));
    if (next === undefined) {
      return fail(
        failure('clipboard.paste-place', FailureKind.Rejected, 'That is not a place in the rack.'),
      );
    }
    pasted = next;
  }
  return succeed(pasted);
}

/** A new chain of the copied slots, under new identifiers, for a target with no rack yet. */
export function chainFromProcessing(payload: ProcessingPayload, ids: IdGenerator): EffectChain {
  return {
    id: ids.next<'EffectChainId'>(),
    slots: payload.slots.map((slot) => copySlot(slot, ids)),
  };
}
