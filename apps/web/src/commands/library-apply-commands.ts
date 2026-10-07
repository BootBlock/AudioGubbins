/**
 * Applying what the person's library keeps (ADR-0060, REQ-AUDIO-017,
 * REQ-AUDIO-086): a saved chain to one target or several, or a preset to a
 * processor, each through the project's own commands as one step one undo
 * reverses. An entry is read afresh from the library before it is applied,
 * since another tab may have changed it, and one this build cannot use is
 * refused with the library's reason.
 *
 * A saved chain goes on what the command names, or on the selection: a selected
 * time range is processed by a copy of it as a rack edit; selected regions or
 * assets, or the whole asset or region shown with nothing selected, each have
 * it as their rack, in place of any rack they had, since a saved chain is a
 * whole rack the person built and applying it to several targets is how they
 * are given the same processing. A rack replaced is removed where nothing else
 * names it, as a chain something names cannot be. Each target gets a chain of
 * its own, so changing one later changes no other; asked to share, every target
 * names one copy, the shared chain of REQ-EDIT-014, so a change to it reaches
 * them all. Both are offered because both are what a person means at different
 * times: a starting point for each target, or one treatment kept in step across
 * them.
 *
 * A preset gives a processor its settings, kept where the processor sits,
 * through the one command that sets a processor.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  chainUseCount,
  chainUsers,
  copyChain,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  withPreset,
  type DomainResult,
  type EditTarget,
  type EffectChain,
  type EffectChainId,
  type LibraryEntryId,
} from '@audiogubbins/domain';
import {
  addChainInvocation,
  removeChainInvocation,
  setProcessorInvocation,
  setRackInvocation,
  type RackTarget,
} from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import type { ChangeOutcome } from '@audiogubbins/storage';
import { counted, quoted } from '@audiogubbins/text';
import { SelectionFacet, type MadeFacet, type TargetRequest } from '@audiogubbins/timeline';

import { rangeRackInvocations } from './chain-placement.js';
import { RANGE_ONLY, editScope, editedView } from './edit-target.js';
import { selectedTarget } from './editor-target.js';
import {
  entryArgument,
  librarySession,
  processorArgument,
  processorIn,
  refused,
  usableOf,
  type LibrarySession,
} from './library-access.js';
import { sayWhenSettled, sessionAvailability } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What applying a saved chain acts on with no targets named. */
const RANGE_OR_OBJECTS: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Time, SelectionFacet.Objects]),
  whenNothing: 'whole-asset',
};

/** Why a selection a saved chain cannot be applied to is refused. */
const NOT_A_TARGET = 'A saved chain is applied to a time range, to regions or to assets.';

/** An asset or a region of the project, named by its identifier. */
type TargetReference =
  | { readonly kind: 'asset'; readonly id: string }
  | { readonly kind: 'region'; readonly id: string };

/** Where a saved chain is put: over one range, or as the rack of each target. */
type Placement =
  | { readonly kind: 'range'; readonly target: EditTarget; readonly name: string }
  | { readonly kind: 'racks'; readonly targets: readonly TargetReference[] };

/** What applying came to, and what is said of it where it was made. */
interface Applied {
  readonly outcome: ChangeOutcome;
  readonly said: string;
}

/** The targets `text` names, as `asset:<id>` and `region:<id>` separated by commas. */
function namedTargets(text: string): readonly TargetReference[] | string {
  const references: TargetReference[] = [];
  for (const part of text.split(',')) {
    const [kind, id, ...rest] = part.trim().split(':');
    if ((kind !== 'asset' && kind !== 'region') || id === undefined || rest.length > 0) {
      return 'Name each target as asset:<identifier> or region:<identifier>.';
    }
    if (!isWellFormedId(id)) return `There is no such ${kind}.`;
    if (!references.some((one) => one.kind === kind && one.id === id)) {
      references.push({ kind, id });
    }
  }
  return references;
}

/** Where a saved chain goes with no targets named: what the editor in use has selected. */
function selectedPlacement(
  context: ShellContext,
  invocation: CommandInvocation,
): Placement | string {
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { view, project } = found;
  const selected = selectedTarget(context, view.asset, RANGE_OR_OBJECTS);
  if (typeof selected === 'string') return selected;
  switch (selected.kind) {
    case 'whole-asset': {
      const { owner } = project;
      return {
        kind: 'racks',
        targets: [
          owner.region === undefined
            ? { kind: 'asset', id: owner.asset.id }
            : { kind: 'region', id: owner.region.id },
        ],
      };
    }
    case 'time': {
      const scope = editScope(context, invocation, RANGE_ONLY);
      if (typeof scope === 'string') return scope;
      if (scope.target.channels !== undefined) {
        return 'A chain of processors acts on every channel. Select every channel first.';
      }
      return { kind: 'range', target: scope.target, name: view.asset.name };
    }
    case 'objects': {
      const { objects } = selected;
      if (objects.kind !== 'regions' && objects.kind !== 'assets') return NOT_A_TARGET;
      const kind = objects.kind === 'regions' ? 'region' : 'asset';
      return { kind: 'racks', targets: objects.ids.map((id) => ({ kind, id })) };
    }
    case 'spectral':
      return NOT_A_TARGET;
  }
}

/** Each named target as the project holds it now, or why one is not in it. */
function rackTargets(
  state: ProjectState,
  references: readonly TargetReference[],
): readonly RackTarget[] | string {
  const targets: RackTarget[] = [];
  for (const reference of references) {
    if (reference.kind === 'asset') {
      const asset = state.project.assets.get(unsafeBrandId<'AssetId'>(reference.id));
      if (asset === undefined) return 'The project has no such asset.';
      targets.push({ kind: 'asset', asset });
    } else {
      const region = state.project.regions.get(unsafeBrandId<'RegionId'>(reference.id));
      const asset = region === undefined ? undefined : state.project.assets.get(region.assetId);
      if (region === undefined || asset === undefined) return 'The project has no such region.';
      targets.push({ kind: 'region', region, asset });
    }
  }
  return targets;
}

/**
 * The invocations that make `chain` the rack of every target, a copy each or
 * one copy shared, and remove each rack they had that nothing else names.
 */
function rackInvocations(
  context: ShellContext,
  state: ProjectState,
  targets: readonly RackTarget[],
  chain: EffectChain,
  share: boolean,
): readonly CommandInvocation[] {
  const shared = copyChain(chain, context.ids);
  const invocations: CommandInvocation[] = share ? [addChainInvocation(shared)] : [];
  const replaced = new Map<EffectChainId, number>();
  for (const target of targets) {
    const own = share ? shared : copyChain(chain, context.ids);
    if (!share) invocations.push(addChainInvocation(own));
    invocations.push(setRackInvocation(target, own.id));
    const before = target.kind === 'asset' ? target.asset.rack : target.region.rack;
    if (before !== undefined) replaced.set(before, (replaced.get(before) ?? 0) + 1);
  }
  // A rack these targets alone named is named by nothing once they are given
  // the new one; one named elsewhere too stays, as it must.
  for (const [before, named] of replaced) {
    if (chainUseCount(chainUsers(state.project, before)) === named) {
      invocations.push(removeChainInvocation(before));
    }
  }
  return invocations;
}

/** What one or several targets are called in a sentence. */
function targetWords(targets: readonly RackTarget[]): string {
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) {
    return quoted(only.kind === 'asset' ? only.asset.displayName : only.region.displayName);
  }
  return counted(targets.length, 'target', 'targets');
}

/** Applies the saved chain `entry` where `placement` says, as one change. */
async function applyChain(
  context: ShellContext,
  reached: LibrarySession,
  entry: LibraryEntryId,
  placement: Placement,
  share: boolean,
): Promise<DomainResult<Applied>> {
  const listed = await reached.library.entry(entry);
  if (!listed.ok) return listed;
  const usable = usableOf(listed.value, 'chain');
  if (!usable.ok) return usable;
  const { name, content } = usable.value;
  // Read once the entry has arrived, so the change is made on the project as
  // it is now, not as it was when the command ran.
  const state = reached.session.getSnapshot().model.state;
  let invocations: readonly CommandInvocation[];
  let where: string;
  if (placement.kind === 'range') {
    const copy = copyChain(content.chain, context.ids);
    invocations = rangeRackInvocations(context, placement.target, copy);
    where = `a range of ${placement.name}`;
  } else {
    const targets = rackTargets(state, placement.targets);
    if (typeof targets === 'string') return refused(targets);
    invocations = rackInvocations(context, state, targets, content.chain, share);
    where = `${targetWords(targets)}${share && targets.length > 1 ? ', one chain shared' : ''}`;
  }
  const [first, ...rest] = invocations;
  if (first === undefined) return refused('There is nothing to apply it to.');
  const ran = await reached.session.runGroup(`Apply the saved chain ${quoted(name)}`, [
    first,
    ...rest,
  ]);
  return ran.ok
    ? succeed({ outcome: ran.value, said: `Applied ${quoted(name)} to ${where}.` })
    : ran;
}

/** What is said once applying settles: what was done, or why nothing changed. */
function saidOf({ outcome, said }: Applied): string {
  return outcome.kind === 'applied' ? said : outcome.reason;
}

function applyChainCommand(): Command<ShellContext> {
  return shellCommand(
    'library.apply-chain',
    'Apply a saved chain',
    CommandCategory.Edit,
    (context, invocation) => {
      const entry = entryArgument(invocation);
      if ('refused' in entry) return entry.refused;
      const reached = librarySession(context);
      if (typeof reached === 'string') return reached;
      const named = textArgument(invocation, 'targets');
      let placement: Placement | string;
      if (named === undefined) {
        placement = selectedPlacement(context, invocation);
      } else {
        const targets = namedTargets(named);
        placement = typeof targets === 'string' ? targets : { kind: 'racks', targets };
      }
      if (typeof placement === 'string') return placement;
      const share = invocation.arguments?.['share'] === true;
      sayWhenSettled(context, applyChain(context, reached, entry.id, placement, share), saidOf);
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: ['apply', 'chain', 'rack', 'library', 'favourite', 'batch'],
      description:
        'Applies a saved chain to the selected range, regions or assets, or to the whole asset or region shown, as one change; each gets its own copy unless asked to share one.',
    },
  );
}

/** Applies the preset `entry` to the processor `processor`, as one change. */
async function applyPreset(
  reached: LibrarySession,
  entry: LibraryEntryId,
  processor: string,
): Promise<DomainResult<Applied>> {
  const listed = await reached.library.entry(entry);
  if (!listed.ok) return listed;
  const usable = usableOf(listed.value, 'preset');
  if (!usable.ok) return usable;
  const { name, content } = usable.value;
  const instance = processorIn(reached.session.getSnapshot().model.state, processor);
  if (instance === undefined) return refused('The project has no such processor now.');
  const set = withPreset(instance, content.processor);
  if (!set.ok) return set;
  // A group of one, so the step is called what the person did, applying the
  // preset, while the change is the one command that sets the processor.
  const ran = await reached.session.runGroup(`Apply the preset ${quoted(name)}`, [
    setProcessorInvocation(set.value),
  ]);
  return ran.ok
    ? succeed({ outcome: ran.value, said: `Applied the preset ${quoted(name)}.` })
    : ran;
}

function applyPresetCommand(): Command<ShellContext> {
  return shellCommand(
    'library.apply-preset',
    'Apply a preset',
    CommandCategory.Edit,
    (context, invocation) => {
      const entry = entryArgument(invocation);
      if ('refused' in entry) return entry.refused;
      const reached = librarySession(context);
      if (typeof reached === 'string') return reached;
      const processor = processorArgument(context, invocation);
      if (processor === undefined) {
        return 'Select one processor, or name it, to apply the preset to.';
      }
      sayWhenSettled(context, applyPreset(reached, entry.id, processor), saidOf);
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: ['apply', 'preset', 'processor', 'settings', 'library'],
      description:
        'Gives the selected processor, or the named one, the settings a preset keeps, as one change.',
    },
  );
}

/** The commands that apply a saved chain or a preset. */
export function libraryApplyCommands(): readonly Command<ShellContext>[] {
  return [applyChainCommand(), applyPresetCommand()];
}
