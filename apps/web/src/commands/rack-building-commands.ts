/**
 * The commands that build and take apart racks (ADR-0060, REQ-AUDIO-017,
 * REQ-EDIT-012, REQ-EDIT-014): adding a processor or a parallel group, taking
 * a target's rack away, removing the processing of a range, and making a
 * shared chain the target's own.
 *
 * A processor or group goes into the rack of the asset or region shown
 * (`rack-target.ts`), at a place in its chain or at its end, the rack made in
 * the same step where there is none; or, asked to go over the selection, into
 * a chain of its own processing the selected range as a rack edit. Each is one
 * step one undo reverses. A processor whose model this page cannot run yet is
 * added all the same, as the project keeps it (ADR-0062), and the person is
 * told why it cannot run.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  SummingLaw,
  chainUseCount,
  chainUsers,
  copyChain,
  instantiateProcessor,
  withSlotAt,
  type ChainSlot,
  type EffectChain,
} from '@audiogubbins/domain';
import {
  addSlotInvocation,
  independentChainInvocations,
  rackRangeInvocation,
  setRackInvocation,
  targetChains,
  withdrawInvocation,
  withdrawRegionEditInvocation,
  type RackTarget,
} from '@audiogubbins/project-commands';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { counted } from '@audiogubbins/text';
import { formatPosition } from '@audiogubbins/timeline';

import { RANGE_ONLY, editScope } from './edit-target.js';
import { needsProjectAsset } from './project-edits.js';
import { lawArgument, placeArgument, slotName } from './rack-arguments.js';
import { changeRacks } from './rack-changes.js';
import { otherUsers, rackScope, targetChain, targetName, type RackScope } from './rack-target.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What the place `selection` asks for: the selected range, as a chain of its own. */
const SELECTION = 'selection';

/** Puts `slot` over the selected range, as a rack edit naming a new chain of it alone. */
function overSelection(
  context: ShellContext,
  invocation: CommandInvocation,
  slot: ChainSlot,
  told: string,
): BodyAnswer {
  const scope = editScope(context, invocation, RANGE_ONLY);
  if (typeof scope === 'string') return scope;
  if (scope.target.channels !== undefined) {
    return 'A chain of processors acts on every channel. Select every channel first.';
  }
  const chain: EffectChain = { id: context.ids.next<'EffectChainId'>(), slots: [slot] };
  return changeRacks(context, {
    description: `Process a range of ${scope.view.asset.name} with ${slotName(slot)}`,
    invocations: [rackRangeInvocation(scope.target, context.ids.next<'EditOperationId'>(), chain)],
    said: `Added ${slotName(slot)} over the selection of ${scope.view.asset.name}, in a chain of its own.${told}`,
  });
}

/** Puts `slot` into the chain of the scope's target the invocation names, at the place it names. */
function intoRack(
  context: ShellContext,
  invocation: CommandInvocation,
  scope: RackScope,
  slot: ChainSlot,
  told: string,
): BodyAnswer {
  const named = targetChain(scope, invocation);
  if (named !== undefined && 'refused' in named) return named.refused;
  const name = targetName(scope.target);
  if (named === undefined) {
    const chain: EffectChain = { id: context.ids.next<'EffectChainId'>(), slots: [slot] };
    return changeRacks(context, {
      description: `Give ${name} a rack`,
      invocations: [setRackInvocation(scope.target, chain)],
      said: `Gave ${name} a rack, with ${slotName(slot)} in it.${told}`,
    });
  }
  const place = placeArgument(invocation, named.chain);
  if (typeof place === 'string') return place;
  if (withSlotAt(named.chain, place, slot) === undefined) return 'That is not a place in the rack.';
  const others = otherUsers(scope.state.project, named.id, scope.target);
  const shared =
    others.length === 0 ? '' : ` Its chain is shared, so ${others.join(', ')} hear it too.`;
  return changeRacks(context, {
    description: `Add ${slotName(slot)} to a rack`,
    invocations: [addSlotInvocation(named.id, place, slot)],
    said: `Added ${slotName(slot)} to the rack of ${name}.${shared}${told}`,
  });
}

/** Places `slot` where the invocation asks, as one change, saying `told` once it is made. */
function placeSlot(
  context: ShellContext,
  invocation: CommandInvocation,
  slot: ChainSlot,
  told = '',
): BodyAnswer {
  const place = textArgument(invocation, 'place');
  if (place === SELECTION) return overSelection(context, invocation, slot, told);
  if (place !== undefined) return 'A processor goes into the rack, or over the selection.';
  const scope = rackScope(context, invocation);
  return typeof scope === 'string' ? scope : intoRack(context, invocation, scope, slot, told);
}

function addProcessorCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.add-processor',
    'Add a processor',
    CommandCategory.Edit,
    (context, invocation) => {
      const typeKey = textArgument(invocation, 'typeKey');
      const descriptor = typeKey === undefined ? undefined : PROCESSOR_CATALOGUE.get(typeKey);
      if (descriptor === undefined) return 'Choose a processor this version has.';
      const processor = instantiateProcessor(context.ids.next<'ProcessorId'>(), descriptor);
      const cannot = context.modelGate.get()(processor);
      return placeSlot(
        context,
        invocation,
        processor,
        cannot === undefined ? '' : ` It cannot run yet: ${cannot}`,
      );
    },
    {
      availability: needsProjectAsset,
      keywords: ['add', 'insert', 'processor', 'effect', 'plug-in', 'rack', 'chain'],
      description:
        'Adds a processor at its defaults to the rack of the asset or region shown, making the rack where there is none, or over the selection in a chain of its own.',
      discoverable: false,
    },
  );
}

function addGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.add-group',
    'Add a parallel group',
    CommandCategory.Edit,
    (context, invocation) => {
      // Two empty branches added by their mean are the input itself, so a
      // group added changes nothing until the person fills a branch.
      const law = lawArgument(invocation, SummingLaw.Mean);
      if (typeof law === 'object') return law.refused;
      const group: ChainSlot = {
        kind: 'group',
        id: context.ids.next<'ProcessorGroupId'>(),
        enabled: true,
        soloed: false,
        mix: 1,
        summing: law,
        branches: [{ slots: [] }, { slots: [] }],
      };
      return placeSlot(context, invocation, group);
    },
    {
      availability: needsProjectAsset,
      keywords: ['group', 'parallel', 'branch', 'split', 'rack'],
      description:
        'Adds a parallel group of two empty branches to the rack of the asset or region shown, each branch a list processors are added into.',
      discoverable: false,
    },
  );
}

/** The target an invocation names by `target`, as `asset:<id>` or `region:<id>`, or the one shown. */
function targetNamed(scope: RackScope, invocation: CommandInvocation): RackTarget | string {
  const named = textArgument(invocation, 'target');
  if (named === undefined) return scope.target;
  const [kind, id] = named.split(':');
  const { project } = scope.state;
  if (kind === 'asset') {
    const asset = [...project.assets.values()].find((one) => one.id === id);
    return asset === undefined ? 'The project has no such asset.' : { kind: 'asset', asset };
  }
  if (kind === 'region') {
    const region = [...project.regions.values()].find((one) => one.id === id);
    const asset = region === undefined ? undefined : project.assets.get(region.assetId);
    return region === undefined || asset === undefined
      ? 'The project has no such region.'
      : { kind: 'region', region, asset };
  }
  return 'Name the target as asset:<identifier> or region:<identifier>.';
}

function removeRackCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.remove-rack',
    'Take a rack away',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = rackScope(context, invocation);
      if (typeof scope === 'string') return scope;
      const target = targetNamed(scope, invocation);
      if (typeof target === 'string') return target;
      const { rack } = targetChains(target);
      const name = targetName(target);
      if (rack === undefined) return `${name} has no rack to take away.`;
      // The project command removes the chain where nothing else names it.
      const kept = chainUseCount(chainUsers(scope.state.project, rack)) > 1;
      return changeRacks(context, {
        description: `Take away the rack of ${name}`,
        invocations: [setRackInvocation(target, undefined)],
        said: kept
          ? `Took away the rack of ${name}. Its chain is kept, as other things use it.`
          : `Took away the rack of ${name}.`,
      });
    },
    {
      availability: needsProjectAsset,
      keywords: ['remove', 'rack', 'chain', 'clear', 'effects'],
      discoverable: false,
    },
  );
}

/**
 * The withdrawal of the range rack edit `operation` of `target`, or why it
 * cannot be withdrawn: a target's edits are a chain read in order, so only the
 * last is withdrawn, and an earlier one goes by undo or once those after it do.
 */
function rangeWithdrawal(target: RackTarget, operation: string): CommandInvocation | string {
  const notLast = `Only the latest edit of ${targetName(target)} can be removed. Undo it, or remove the edits made after it, first.`;
  if (target.kind === 'asset') {
    const last = target.asset.edits.at(-1);
    return last?.id === operation ? withdrawInvocation(target.asset, last) : notLast;
  }
  const last = target.region.operations.at(-1);
  return last?.id === operation ? withdrawRegionEditInvocation(target.region, last) : notLast;
}

function removeRangeCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.remove-range',
    'Remove this processing',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = rackScope(context, invocation);
      if (typeof scope === 'string') return scope;
      const operation = textArgument(invocation, 'operationId');
      const range = targetChains(scope.target).ranges.find((one) => one.operation === operation);
      const name = targetName(scope.target);
      if (range === undefined) return `No range of ${name} is processed by that chain.`;
      const withdrawal = rangeWithdrawal(scope.target, range.operation);
      if (typeof withdrawal === 'string') return withdrawal;
      const at = (frames: number): string =>
        formatPosition(frames, scope.view.asset.sampleRate, scope.view.state.timeFormat);
      // The project command removes the chain where nothing else names it.
      return changeRacks(context, {
        description: `Remove the processing of a range of ${name}`,
        invocations: [withdrawal],
        said: `Removed the processing of ${name} from ${at(range.range.start)} to ${at(range.range.end)}.`,
      });
    },
    {
      availability: needsProjectAsset,
      keywords: ['remove', 'range', 'processing', 'chain', 'rack', 'selection'],
      description:
        'Removes the chain of processors over a range of the asset or region shown, the latest edit made to it.',
      discoverable: false,
    },
  );
}

function makeIndependentCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.make-independent',
    'Make a shared chain this target’s own',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = rackScope(context, invocation);
      if (typeof scope === 'string') return scope;
      const named = targetChain(scope, invocation);
      const name = targetName(scope.target);
      if (named === undefined) return `${name} has no rack.`;
      if ('refused' in named) return named.refused;
      const others = otherUsers(scope.state.project, named.id, scope.target);
      if (others.length === 0) return `The chain is ${name}’s alone already; nothing else uses it.`;
      return changeRacks(context, {
        description: `Make the chain of ${name} its own`,
        invocations: independentChainInvocations(
          scope.target,
          named.id,
          copyChain(named.chain, context.ids),
        ),
        said: `${name} has a chain of its own now, a copy; ${counted(others.length, 'other use', 'other uses')} keep the shared one.`,
      });
    },
    {
      availability: needsProjectAsset,
      keywords: ['independent', 'unshare', 'copy', 'shared', 'chain', 'rack'],
      discoverable: false,
    },
  );
}

/** The commands that build and take apart racks. */
export function rackBuildingCommands(): readonly Command<ShellContext>[] {
  return [
    addProcessorCommand(),
    addGroupCommand(),
    removeRackCommand(),
    removeRangeCommand(),
    makeIndependentCommand(),
  ];
}
