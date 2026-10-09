/**
 * The commands that change the slots of a rack (ADR-0060, REQ-AUDIO-017):
 * removing a processor or group, moving one within its chain, bypassing,
 * soloing and mixing one, and choosing how a parallel group adds its
 * branches. Each acts on the slots it names by `slot`, or on the processors
 * selected in the editor in use, through the project's commands, one step
 * one undo reverses, reaching every target that names the chain.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  findSlot,
  slotsAt,
  withSlotMoved,
  withoutSlot,
  type ChainSlot,
  type EffectChain,
  type SlotPlace,
} from '@audiogubbins/domain';
import {
  moveSlotInvocation,
  removeSlotsInvocations,
  setSlotControlInvocation,
} from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';
import { SelectionFacet, withoutFacet } from '@audiogubbins/timeline';

import { focusedEditor, numberArgument } from './editor-target.js';
import { needsProjectAsset } from './project-edits.js';
import { sessionOf } from './project-access.js';
import {
  LAW_NAMES,
  lawArgument,
  placeArgument,
  slotName,
  switchArgument,
} from './rack-arguments.js';
import { changeRacks } from './rack-changes.js';
import { namedSlots, type HeldSlot } from './rack-target.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The slots a command acts on, and the project as it stands; or why there are none. */
function slotsOf(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly state: ProjectState; readonly held: readonly [HeldSlot, ...HeldSlot[]] } | string {
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  const state = session.getSnapshot().model.state;
  const held = namedSlots(context, invocation, state);
  return typeof held === 'string' ? held : { state, held };
}

/** What the slots are called together: one by its name, more by their count. */
function slotsWords(held: readonly HeldSlot[]): string {
  const [only] = held;
  return held.length === 1 && only !== undefined
    ? slotName(only.slot)
    : counted(held.length, 'processor', 'processors');
}

/** How a switch is spoken of: as a step of the history, once made, and when it is so already. */
interface SwitchWords {
  readonly step: string;
  readonly done: string;
  readonly already: string;
}

/** A command that switches a control of each slot it acts on, on or off. */
function switchCommand(
  id: string,
  label: string,
  control: 'enabled' | 'soloed',
  words: { readonly on: SwitchWords; readonly off: SwitchWords },
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Edit,
    (context, invocation) => {
      const found = slotsOf(context, invocation);
      if (typeof found === 'string') return found;
      const { held } = found;
      const [first] = held;
      const value = switchArgument(invocation, control, first.slot[control]);
      if (typeof value === 'object') return value.refused;
      const changed = held.filter(({ slot }) => slot[control] !== value);
      const spoken = value ? words.on : words.off;
      if (changed.length === 0) {
        return unchanged('rack.unchanged', `${slotsWords(held)} ${spoken.already}.`);
      }
      return changeRacks(context, {
        description: `${spoken.step} ${slotsWords(changed)}`,
        invocations: changed.map(({ slot }) =>
          setSlotControlInvocation(slot.id, { control, value }),
        ),
        said: `${spoken.done} ${slotsWords(changed)}.`,
      });
    },
    { availability: needsProjectAsset, keywords },
  );
}

function setMixCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.set-mix',
    'Set the mix of a processor',
    CommandCategory.Edit,
    (context, invocation) => {
      const found = slotsOf(context, invocation);
      if (typeof found === 'string') return found;
      const mix = numberArgument(invocation, 'mix');
      if (mix === undefined || mix < 0 || mix > 1) {
        return 'The mix is from 0, its input alone, to 1, its output alone.';
      }
      const changed = found.held.filter(({ slot }) => !Object.is(slot.mix, mix));
      if (changed.length === 0) {
        return unchanged('rack.unchanged', `${slotsWords(found.held)} is mixed so already.`);
      }
      const percent = `${String(Math.round(mix * 100))}%`;
      return changeRacks(context, {
        description: `Mix ${slotsWords(changed)} at ${percent}`,
        invocations: changed.map(({ slot }) =>
          setSlotControlInvocation(slot.id, { control: 'mix', value: mix }),
        ),
        said: `${slotsWords(changed)} is mixed at ${percent} processed.`,
      });
    },
    {
      availability: needsProjectAsset,
      keywords: ['mix', 'wet', 'dry', 'blend', 'parallel'],
      discoverable: false,
    },
  );
}

function setLawCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.set-group-law',
    'Choose how a parallel group adds its branches',
    CommandCategory.Edit,
    (context, invocation) => {
      const found = slotsOf(context, invocation);
      if (typeof found === 'string') return found;
      const groups = found.held.flatMap(({ slot }) => (slot.kind === 'group' ? [slot] : []));
      if (groups.length !== found.held.length) return 'Only a parallel group adds branches.';
      const law = lawArgument(invocation, undefined);
      if (typeof law === 'object') return law.refused;
      const changed = groups.filter((group) => group.summing !== law);
      if (changed.length === 0) {
        return unchanged(
          'rack.unchanged',
          `The group adds its branches by ${LAW_NAMES[law].toLowerCase()} already.`,
        );
      }
      return changeRacks(context, {
        description: `Add a group’s branches by ${LAW_NAMES[law].toLowerCase()}`,
        invocations: changed.map((group) =>
          setSlotControlInvocation(group.id, { control: 'summing', value: law }),
        ),
        said: `The group adds its branches by ${LAW_NAMES[law].toLowerCase()}.`,
      });
    },
    { keywords: ['group', 'parallel', 'sum', 'mean', 'equal power', 'law'], discoverable: false },
  );
}

function removeCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.remove-processor',
    'Remove a processor from its rack',
    CommandCategory.Edit,
    (context, invocation) => {
      const found = slotsOf(context, invocation);
      if (typeof found === 'string') return found;
      const refused = changeRacks(context, {
        description: `Remove ${slotsWords(found.held)} from a rack`,
        invocations: removeSlotsInvocations(
          found.state,
          found.held.map(({ slot }) => slot.id),
        ),
        said: `Removed ${slotsWords(found.held)} from the rack.`,
      });
      if (refused !== undefined) return refused;
      // What was removed is no longer there to be selected.
      if (textArgument(invocation, 'slot') === undefined) {
        const view = focusedEditor(context);
        if (typeof view !== 'string') {
          context.selections.change(view.asset.id, (current) =>
            withoutFacet(current, SelectionFacet.Objects),
          );
        }
      }
      return undefined;
    },
    {
      availability: needsProjectAsset,
      keywords: ['remove', 'delete', 'processor', 'effect', 'rack'],
    },
  );
}

/** Which way a move goes within a list. */
type Direction = 'up' | 'down';

/** The place a move takes `slot` to in `chain`, stated as the chain stands without it, or why none. */
function moveTarget(
  invocation: CommandInvocation,
  chain: EffectChain,
  slot: ChainSlot,
): SlotPlace | string {
  const direction = textArgument(invocation, 'direction');
  const found = findSlot(chain, slot.id);
  if (found === undefined) return 'The processor is no longer in its rack.';
  if (direction === undefined) {
    const without = withoutSlot(chain, slot.id);
    return without === undefined
      ? 'The processor is no longer in its rack.'
      : placeArgument(invocation, without);
  }
  if (direction !== 'up' && direction !== 'down') return 'Move it up or down, or to a place.';
  const way: Direction = direction;
  const length = slotsAt(chain, found.place.group)?.length ?? 0;
  const index = found.place.index + (way === 'up' ? -1 : 1);
  if (index < 0) return `${slotName(slot)} is first in its list already.`;
  if (index >= length) return `${slotName(slot)} is last in its list already.`;
  return { ...found.place, index };
}

function moveCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.move-processor',
    'Move a processor in its rack',
    CommandCategory.Edit,
    (context, invocation) => {
      const found = slotsOf(context, invocation);
      if (typeof found === 'string') return found;
      if (found.held.length !== 1) return 'Move one processor or group at a time.';
      const [{ slot, chain }] = found.held;
      const place = moveTarget(invocation, chain, slot);
      if (typeof place === 'string') return place;
      const moved = withSlotMoved(chain, slot.id, place);
      if (moved === undefined) return 'A group cannot be moved into itself.';
      const before = findSlot(chain, slot.id)?.place;
      const after = findSlot(moved, slot.id)?.place;
      if (
        before?.group?.id === after?.group?.id &&
        before?.group?.branch === after?.group?.branch &&
        before?.index === after?.index
      ) {
        return unchanged('rack.unchanged', `${slotName(slot)} is there already.`);
      }
      const at = after === undefined ? undefined : slotsAt(moved, after.group)?.length;
      return changeRacks(context, {
        description: `Move ${slotName(slot)}`,
        invocations: [moveSlotInvocation(slot.id, place)],
        said: `Moved ${slotName(slot)} to place ${String((after?.index ?? 0) + 1)} of ${String(at ?? 0)}.`,
      });
    },
    {
      availability: needsProjectAsset,
      keywords: ['move', 'reorder', 'up', 'down', 'processor', 'rack', 'order'],
      discoverable: false,
    },
  );
}

/** The commands that change the slots of a rack. */
export function rackSlotCommands(): readonly Command<ShellContext>[] {
  return [
    removeCommand(),
    moveCommand(),
    switchCommand(
      'rack.set-enabled',
      'Bypass or switch on a processor',
      'enabled',
      {
        on: { step: 'Switch on', done: 'Switched on', already: 'is on already' },
        off: { step: 'Bypass', done: 'Bypassed', already: 'is bypassed already' },
      },
      ['bypass', 'enable', 'disable', 'switch', 'processor', 'effect'],
    ),
    switchCommand(
      'rack.set-soloed',
      'Solo a processor',
      'soloed',
      {
        on: { step: 'Solo', done: 'Soloed', already: 'is soloed already' },
        off: { step: 'Stop soloing', done: 'Stopped soloing', already: 'is not soloed' },
      },
      ['solo', 'alone', 'audition', 'processor', 'effect'],
    ),
    setMixCommand(),
    setLawCommand(),
  ];
}
