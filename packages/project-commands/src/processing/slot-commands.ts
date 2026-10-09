/**
 * The commands that change the slots of a chain (ADR-0060, REQ-AUDIO-017):
 * adding a processor or a parallel group at a place, removing one, moving one
 * within its chain, and setting one of its controls, its bypass, solo or mix,
 * or how a group adds its branches. Each reaches every operation and target
 * that names the chain, which is what a shared chain is (REQ-EDIT-014), and
 * each has its inverse among them, so one undo reverses it exactly.
 *
 * A slot is named by its identifier, which names one slot in the whole
 * project (`chain-checks.ts`), so each changes that slot and nothing beside
 * it: a change made meanwhile to another slot of its chain is kept, as
 * setting the whole chain would not keep it. A chain changed is held to the
 * domain's bounds on its shape (`validateChainShape`); whether this build can
 * run it is not checked here, for the reason `chain-checks.ts` gives.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  findSlot,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  validateChainShape,
  withSlotAt,
  withSlotMoved,
  withSlotReplaced,
  withoutSlot,
  type ChainSlot,
  type DomainResult,
  type EffectChain,
  type EffectChainId,
  type ProcessorCatalogue,
  type SlotPlace,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  readSlotAlone,
  writeSlot,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, readNested, refusedBy, textArgument } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { slotIdentifiers } from './chain-checks.js';
import { chainChangeDescription, slotMoveDescription } from './chain-descriptions.js';
import { withChain } from './chain-naming.js';
import {
  controlArgument,
  namedSlot,
  placeArgument,
  slotIn,
  type SlotControl,
} from './slot-arguments.js';

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The arguments that state `place`. */
function placeArguments(place: SlotPlace): Readonly<Record<string, string | number>> {
  return place.group === undefined
    ? { index: place.index }
    : { group: place.group.id, branch: place.group.branch, index: place.index };
}

/** The invocation that adds `slot` to the chain `chain` at `place`. */
export function addSlotInvocation(
  chain: EffectChainId,
  place: SlotPlace,
  slot: ChainSlot,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddSlot,
    arguments: { chainId: chain, slot: canonicalJson(writeSlot(slot)), ...placeArguments(place) },
  };
}

/** The invocation that removes the slot `slot`, a processor or a group with all it holds. */
export function removeSlotInvocation(slot: ChainSlot['id']): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveSlot, arguments: { slotId: slot } };
}

/**
 * The invocations that remove the slots `slots` of the project, each once: a
 * slot inside a group also named goes with the group.
 */
export function removeSlotsInvocations(
  state: ProjectState,
  slots: readonly ChainSlot['id'][],
): readonly CommandInvocation[] {
  const groups = slots.flatMap((id) => {
    const found = slotIn(state, id);
    return found?.slot.kind === 'group' ? [found.slot] : [];
  });
  const inside = (id: string): boolean =>
    groups.some((group) => group.id !== id && findSlot({ slots: [group] }, id) !== undefined);
  return [...new Set(slots)].filter((id) => !inside(id)).map(removeSlotInvocation);
}

/** The invocation that moves the slot `slot` to `place`, stated as its chain stands without it. */
export function moveSlotInvocation(slot: ChainSlot['id'], place: SlotPlace): CommandInvocation {
  return {
    commandId: ProjectCommandId.MoveSlot,
    arguments: { slotId: slot, ...placeArguments(place) },
  };
}

/** The invocation that sets a control of the slot `slot`. */
export function setSlotControlInvocation(
  slot: ChainSlot['id'],
  { control, value }: SlotControl,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetSlotControl,
    arguments: { slotId: slot, control, value },
  };
}

/**
 * The state with `chain` changed to `changed`, held to the domain's bounds on
 * a chain's shape, and what the change is called; or why it is refused.
 */
function changedChain(
  state: ProjectState,
  chain: EffectChain,
  changed: EffectChain | undefined,
  catalogue: ProcessorCatalogue,
): DomainResult<{ readonly next: ProjectState; readonly description: string }> {
  if (changed === undefined) {
    return rejected('slot.place-unknown', 'That is not a place in the chain.');
  }
  const shape = validateChainShape(changed);
  if (!shape.ok) return shape;
  return succeed({
    next: withChain(state, changed),
    description: chainChangeDescription(chain, changed, catalogue),
  });
}

function addSlot(
  state: ProjectState,
  invocation: CommandInvocation,
  catalogue: ProcessorCatalogue,
): CommandOutcome<ProjectState> {
  const chainText = textArgument(invocation, 'chainId');
  if (!chainText.ok) return refusedBy(chainText);
  const chain = isWellFormedId(chainText.value)
    ? state.project.effectChains.get(unsafeBrandId<'EffectChainId'>(chainText.value))
    : undefined;
  if (chain === undefined)
    return refusal('chain.unknown', 'The project has no chain with that identifier.');
  const value = jsonArgument(invocation, 'slot');
  if (!value.ok) return refusedBy(value);
  const slot = readNested(readSlotAlone, value.value, 'slot');
  if (!slot.ok) return refusedBy(slot);
  const place = placeArgument(invocation);
  if (!place.ok) return refusedBy(place);
  if ([...slotIdentifiers([slot.value])].some((id) => slotIn(state, id) !== undefined)) {
    return refusal(
      'chain.duplicate-slot',
      'A processor added has the identifier of one already in the project.',
    );
  }
  const change = changedChain(state, chain, withSlotAt(chain, place.value, slot.value), catalogue);
  if (!change.ok) return refusedBy(change);
  return applied(change.value.next, removeSlotInvocation(slot.value.id), change.value.description);
}

function removeSlot(
  state: ProjectState,
  invocation: CommandInvocation,
  catalogue: ProcessorCatalogue,
): CommandOutcome<ProjectState> {
  const held = namedSlot(state, invocation);
  if (!held.ok) return refusedBy(held);
  const { chain, slot, place } = held.value;
  const change = changedChain(state, chain, withoutSlot(chain, slot.id), catalogue);
  if (!change.ok) return refusedBy(change);
  return applied(
    change.value.next,
    addSlotInvocation(chain.id, place, slot),
    change.value.description,
  );
}

function moveSlot(
  state: ProjectState,
  invocation: CommandInvocation,
  catalogue: ProcessorCatalogue,
): CommandOutcome<ProjectState> {
  const held = namedSlot(state, invocation);
  if (!held.ok) return refusedBy(held);
  const place = placeArgument(invocation);
  if (!place.ok) return refusedBy(place);
  const { chain, slot, place: was } = held.value;
  const moved = withSlotMoved(chain, slot.id, place.value);
  if (
    moved !== undefined &&
    canonicalJson(moved.slots.map(writeSlot)) === canonicalJson(chain.slots.map(writeSlot))
  ) {
    return unchanged('slot.unchanged', 'The processor is there already.');
  }
  const change = changedChain(state, chain, moved, catalogue);
  if (!change.ok) return refusedBy(change);
  // A slot's place in its chain as it stands is its place once it is taken
  // out, since nothing before it moves.
  return applied(
    change.value.next,
    moveSlotInvocation(slot.id, was),
    slotMoveDescription(slot, catalogue),
  );
}

/** The control `control` names as `slot` has it, or `undefined` where a processor has none. */
function controlOf(slot: ChainSlot, control: SlotControl['control']): SlotControl | undefined {
  switch (control) {
    case 'enabled':
    case 'soloed':
      return { control, value: slot[control] };
    case 'mix':
      return { control, value: slot.mix };
    case 'summing':
      return slot.kind === 'group' ? { control, value: slot.summing } : undefined;
  }
}

function setSlotControl(
  state: ProjectState,
  invocation: CommandInvocation,
  catalogue: ProcessorCatalogue,
): CommandOutcome<ProjectState> {
  const held = namedSlot(state, invocation);
  if (!held.ok) return refusedBy(held);
  const control = controlArgument(invocation);
  if (!control.ok) return refusedBy(control);
  const { chain, slot } = held.value;
  const before = controlOf(slot, control.value.control);
  if (before === undefined) {
    return refusal('slot.not-group', 'Only a parallel group adds branches.');
  }
  if (Object.is(before.value, control.value.value)) {
    return unchanged('slot.unchanged', 'The slot is already set as asked.');
  }
  const set: ChainSlot =
    control.value.control === 'summing'
      ? slot.kind === 'group'
        ? { ...slot, summing: control.value.value }
        : slot
      : { ...slot, [control.value.control]: control.value.value };
  const change = changedChain(state, chain, withSlotReplaced(chain, set), catalogue);
  if (!change.ok) return refusedBy(change);
  return applied(
    change.value.next,
    setSlotControlInvocation(slot.id, before),
    change.value.description,
  );
}

/** The commands that change the slots of a chain, described by `catalogue`'s names. */
export function slotCommands(catalogue: ProcessorCatalogue): readonly ProjectCommand[] {
  const declare = (
    id: ProjectCommand['id'],
    label: string,
    description: string,
    run: (
      state: ProjectState,
      invocation: CommandInvocation,
      catalogue: ProcessorCatalogue,
    ) => CommandOutcome<ProjectState>,
  ): ProjectCommand =>
    projectCommand({
      id,
      label,
      category: CommandCategory.Edit,
      description,
      provenance: NO_PROVENANCE,
      run: (state, invocation) => run(state, invocation, catalogue),
    });
  return [
    declare(
      ProjectCommandId.AddSlot,
      'Add a processor to a chain',
      'Adds a processor or a parallel group at a place in a chain, wherever the chain is named.',
      addSlot,
    ),
    declare(
      ProjectCommandId.RemoveSlot,
      'Remove a processor from a chain',
      'Removes a processor, or a parallel group with all it holds, from its chain.',
      removeSlot,
    ),
    declare(
      ProjectCommandId.MoveSlot,
      'Move a processor in its chain',
      'Moves a processor or a parallel group to another place in its chain.',
      moveSlot,
    ),
    declare(
      ProjectCommandId.SetSlotControl,
      'Set a control of a processor',
      'Bypasses, solos or mixes a processor or a parallel group, or sets how a group adds its branches.',
      setSlotControl,
    ),
  ];
}
