/**
 * Copying and pasting processors (ADR-0053 as amended by ADR-0060): the
 * selected processors, or a whole rack with none selected, held by the one
 * clipboard as its processing payload, in place of whatever it held; and
 * pasted into the rack shown as copies under new identifiers, after the one
 * processor selected there or where the invocation names, the rack made where
 * there is none, in one step one undo reverses. Copying changes nothing of
 * the project; the clipboard is the page's.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { findSlot, withSlotAt, type ChainSlot, type SlotPlace } from '@audiogubbins/domain';
import {
  chainFromProcessing,
  copyProcessing,
  pastedSlots,
  type ClipboardPayload,
  type ProcessingPayload,
} from '@audiogubbins/clipboard';
import { canonicalJson, writeSlot } from '@audiogubbins/project-format';
import { addSlotInvocation, setRackInvocation } from '@audiogubbins/project-commands';
import { counted } from '@audiogubbins/text';

import { needsProjectAsset } from './project-edits.js';
import { placeArgument, slotName } from './rack-arguments.js';
import { changeRacks } from './rack-changes.js';
import {
  namedSlots,
  rackScope,
  targetChain,
  targetName,
  type NamedChain,
  type RackScope,
} from './rack-target.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What slots are called together, as the clipboard says what a paste will bring. */
function slotsWords(slots: readonly ChainSlot[]): string {
  const [only] = slots;
  return slots.length === 1 && only !== undefined
    ? slotName(only)
    : counted(slots.length, 'processor', 'processors');
}

/** The slots a copy takes: those named or selected, or the whole rack shown with none. */
function copied(
  context: ShellContext,
  invocation: CommandInvocation,
  scope: RackScope,
): { readonly slots: readonly ChainSlot[]; readonly whole: boolean } | string {
  const selected = context.selections.of(scope.view.asset.id).objects?.kind === 'processors';
  if (textArgument(invocation, 'slot') !== undefined || selected) {
    const held = namedSlots(context, invocation, scope.state);
    return typeof held === 'string' ? held : { slots: held.map(({ slot }) => slot), whole: false };
  }
  const named = targetChain(scope, invocation);
  if (named === undefined) return `${targetName(scope.target)} has no rack to copy.`;
  if ('refused' in named) return named.refused;
  return { slots: named.chain.slots, whole: true };
}

/** Whether `held` is processing of the very slots `copy` holds, set as they are now. */
function sameProcessing(held: ClipboardPayload | undefined, copy: ProcessingPayload): boolean {
  if (held?.kind !== 'processing' || held.wholeChain !== copy.wholeChain) return false;
  const written = (slots: readonly ChainSlot[]): string =>
    canonicalJson(slots.map((slot) => writeSlot(slot)));
  return written(held.slots) === written(copy.slots);
}

function copyCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.copy',
    'Copy processors',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = rackScope(context, invocation);
      if (typeof scope === 'string') return scope;
      const taken = copied(context, invocation, scope);
      if (typeof taken === 'string') return taken;
      const payload = copyProcessing(taken.slots, taken.whole);
      if (!payload.ok) return payload.failures[0].summary;
      const words = taken.whole
        ? `the rack of ${targetName(scope.target)}`
        : slotsWords(taken.slots);
      if (sameProcessing(context.clipboard.get().copied, payload.value)) {
        return unchanged(
          'rack.copied-already',
          `${words} ${taken.whole ? 'is' : 'are'} copied already.`,
        );
      }
      context.clipboard.hold(payload.value, words);
      context.interaction.announce(`Copied ${words}. Paste them into a rack.`);
      return undefined;
    },
    {
      availability: needsProjectAsset,
      keywords: ['copy', 'processor', 'rack', 'chain', 'clipboard'],
      discoverable: false,
    },
  );
}

/** The processing the clipboard holds, and what it is called, or why it holds none. */
function heldProcessing(
  context: ShellContext,
): { readonly payload: ProcessingPayload; readonly words: string } | string {
  const { copied: payload, description } = context.clipboard.get();
  if (payload === undefined) return 'Nothing is copied. Copy processors from a rack first.';
  if (payload.kind !== 'processing') {
    return 'The clipboard holds audio, which is pasted into the timeline, not a rack.';
  }
  return { payload, words: description ?? slotsWords(payload.slots) };
}

/**
 * Where a paste goes in `named`: where the invocation says, or after the one
 * processor selected in it, or at the end of the chain.
 */
function pasteAt(
  context: ShellContext,
  invocation: CommandInvocation,
  scope: RackScope,
  named: NamedChain,
): SlotPlace | string {
  const placed = ['group', 'branch', 'index'].some(
    (name) => invocation.arguments?.[name] !== undefined,
  );
  if (placed) return placeArgument(invocation, named.chain);
  const objects = context.selections.of(scope.view.asset.id).objects;
  const [last] = objects?.kind === 'processors' ? objects.ids.toReversed() : [];
  const found = last === undefined ? undefined : findSlot(named.chain, last);
  return found === undefined
    ? { index: named.chain.slots.length }
    : { ...found.place, index: found.place.index + 1 };
}

function pasteCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.paste',
    'Paste processors',
    CommandCategory.Edit,
    (context, invocation): BodyAnswer => {
      const held = heldProcessing(context);
      if (typeof held === 'string') return held;
      const scope = rackScope(context, invocation);
      if (typeof scope === 'string') return scope;
      const named = targetChain(scope, invocation);
      const name = targetName(scope.target);
      if (named === undefined) {
        return changeRacks(context, {
          description: `Give ${name} a rack`,
          invocations: [
            setRackInvocation(scope.target, chainFromProcessing(held.payload, context.ids)),
          ],
          said: `Pasted ${held.words} into a new rack of ${name}.`,
        });
      }
      if ('refused' in named) return named.refused;
      const place = pasteAt(context, invocation, scope, named);
      if (typeof place === 'string') return place;
      if (withSlotAt(named.chain, place, held.payload.slots[0]) === undefined) {
        return 'That is not a place in the rack.';
      }
      // Each after the one before.
      return changeRacks(context, {
        description: `Paste ${held.words} into a rack`,
        invocations: pastedSlots(held.payload, context.ids).map((slot, offset) =>
          addSlotInvocation(named.id, { ...place, index: place.index + offset }, slot),
        ),
        said: `Pasted ${held.words} into the rack of ${name}.`,
      });
    },
    {
      availability: needsProjectAsset,
      keywords: ['paste', 'processor', 'rack', 'chain', 'clipboard'],
      discoverable: false,
    },
  );
}

/** The commands that copy and paste processors. */
export function rackClipboardCommands(): readonly Command<ShellContext>[] {
  return [copyCommand(), pasteCommand()];
}
