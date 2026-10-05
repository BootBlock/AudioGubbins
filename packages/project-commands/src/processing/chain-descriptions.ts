/**
 * What the history and the undo menu call a change to a chain: the one thing
 * a person did to it, where one thing was done, in the processor's own name.
 */

import type { ChainSlot, EffectChain, ProcessorCatalogue } from '@audiogubbins/domain';
import { canonicalJson, writeSlot } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

/** Every slot of `slots` by identifier, with the list it is in and its place there. */
function placed(
  slots: readonly ChainSlot[],
  list = '',
  into = new Map<
    string,
    { readonly slot: ChainSlot; readonly list: string; readonly index: number }
  >(),
) {
  for (const [index, slot] of slots.entries()) {
    into.set(slot.id, { slot, list, index });
    if (slot.kind === 'group') {
      slot.branches.forEach((branch, place) =>
        placed(branch.slots, `${slot.id}/${String(place)}`, into),
      );
    }
  }
  return into;
}

/**
 * Whether two versions of a slot hold the same settings of their own: a
 * group's are its switches, mix, law and number of branches, not the slots
 * inside it, which are compared as slots of their own. A chain arrives in a
 * command as text, so its slots are compared by value, never by identity.
 */
function sameOwnSettings(before: ChainSlot, after: ChainSlot): boolean {
  if (before.kind === 'group' && after.kind === 'group') {
    return (
      before.enabled === after.enabled &&
      before.soloed === after.soloed &&
      Object.is(before.mix, after.mix) &&
      before.summing === after.summing &&
      before.branches.length === after.branches.length
    );
  }
  return (
    before.kind === 'processor' &&
    after.kind === 'processor' &&
    canonicalJson(writeSlot(before)) === canonicalJson(writeSlot(after))
  );
}

/** What a slot is called. */
function slotLabel(slot: ChainSlot, catalogue: ProcessorCatalogue): string {
  if (slot.kind === 'group') return 'a parallel group';
  return quoted(catalogue.get(slot.typeKey)?.label ?? slot.typeKey);
}

/** What changing one slot from `before` to `after` is called. */
function slotChange(
  before: ChainSlot,
  after: ChainSlot,
  moved: boolean,
  catalogue: ProcessorCatalogue,
): string {
  const label = slotLabel(after, catalogue);
  if (before.enabled !== after.enabled) return `${after.enabled ? 'Switch on' : 'Bypass'} ${label}`;
  if (before.soloed !== after.soloed) return `${after.soloed ? 'Solo' : 'Stop soloing'} ${label}`;
  if (before.mix !== after.mix) return `Change the mix of ${label}`;
  if (before.kind === 'processor' && after.kind === 'processor') {
    const changed = [...after.values].filter(
      ([id, value]) => !Object.is(before.values.get(id), value),
    );
    const [only] = changed;
    if (changed.length === 1 && only !== undefined) {
      const name = catalogue
        .get(after.typeKey)
        ?.parameters.find((one) => one.id === only[0])?.label;
      return name === undefined
        ? `Change ${label}`
        : `Change the ${name.toLowerCase()} of ${label}`;
    }
    const learned = (slot: typeof before): string => JSON.stringify(slot.state ?? null);
    if (learned(before) !== learned(after)) return `Change what ${label} learned`;
  }
  if (before.kind === 'group' && after.kind === 'group' && before.summing !== after.summing) {
    return `Change how ${label} adds its branches`;
  }
  return moved ? `Move ${label}` : `Change ${label}`;
}

/** What a change from `before` to `after` of one chain is called. */
export function chainChangeDescription(
  before: EffectChain,
  after: EffectChain,
  catalogue: ProcessorCatalogue,
): string {
  const was = placed(before.slots);
  const is = placed(after.slots);
  const added = [...is.values()].filter(({ slot }) => !was.has(slot.id));
  const removed = [...was.values()].filter(({ slot }) => !is.has(slot.id));
  const [one] = added;
  if (added.length >= 1 && removed.length === 0 && one !== undefined) {
    return `Add ${slotLabel(one.slot, catalogue)} to a rack`;
  }
  const [gone] = removed;
  if (removed.length >= 1 && added.length === 0 && gone !== undefined) {
    return `Remove ${slotLabel(gone.slot, catalogue)} from a rack`;
  }
  if (added.length > 0) return 'Change a rack';
  // A slot whose value is a new one was changed; one whose value is the same
  // but whose place is not was only moved, by itself or by a move beside it.
  const changed = [...is.values()].filter(({ slot }) => {
    const previous = was.get(slot.id)?.slot;
    return previous === undefined || !sameOwnSettings(previous, slot);
  });
  const [only] = changed;
  if (changed.length === 1 && only !== undefined) {
    const previous = was.get(only.slot.id);
    if (previous !== undefined) {
      const moved = previous.list !== only.list || previous.index !== only.index;
      return slotChange(previous.slot, only.slot, moved, catalogue);
    }
  }
  const reordered = [...is.values()].some(({ slot, list, index }) => {
    const previous = was.get(slot.id);
    return previous !== undefined && (previous.list !== list || previous.index !== index);
  });
  return changed.length === 0 && reordered ? 'Reorder a rack' : 'Change a rack';
}
