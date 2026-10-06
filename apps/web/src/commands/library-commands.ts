/**
 * Keeping the person's library of saved chains and presets (ADR-0060,
 * REQ-AUDIO-017, REQ-AUDIO-086): saving a chain of the open project, or one
 * processor's settings as a preset, under a name or in place of an entry, and
 * renaming and removing an entry. The library is the person's, not the
 * project's, so none of these is undone with the project; applying an entry
 * changes the project (`library-apply-commands.ts`). Each is the library's to
 * refuse, and its reason is said as it gave it.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  isWellFormedId,
  unsafeBrandId,
  type EffectChain,
  type LibraryContent,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import type { SavedProcessingStore } from '../state/saved-processing-store.js';
import { editedView } from './edit-target.js';
import {
  KIND_NAMES,
  entryArgument,
  librarySession,
  processorArgument,
  processorIn,
} from './library-access.js';
import {
  projectsAvailability,
  readyProjects,
  sayWhenSettled,
  sessionAvailability,
} from './project-access.js';
import { namingCommand, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The chain an invocation names by `chainId`, or the rack of the asset or region shown. */
function chainToSave(
  context: ShellContext,
  invocation: CommandInvocation,
  state: ProjectState,
): EffectChain | string {
  const named = textArgument(invocation, 'chainId');
  if (named !== undefined) {
    const chain = isWellFormedId(named)
      ? state.project.effectChains.get(unsafeBrandId<'EffectChainId'>(named))
      : undefined;
    return chain ?? 'The project has no chain with that identifier.';
  }
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { owner } = found.project;
  const rack =
    owner.region === undefined
      ? state.project.assets.get(owner.asset.id)?.rack
      : state.project.regions.get(owner.region.id)?.rack;
  const shown = quoted(owner.region?.displayName ?? owner.asset.displayName);
  if (rack === undefined) return `${shown} has no rack to save. Give it one, or name the chain.`;
  return state.project.effectChains.get(rack) ?? `The rack of ${shown} names no chain.`;
}

/**
 * Saves `content` under the invocation's `name`, or, where it names an
 * `entry`, puts it in place of that entry's content, and says what was done.
 */
function keep(
  context: ShellContext,
  invocation: CommandInvocation,
  library: SavedProcessingStore,
  content: LibraryContent,
): string | undefined {
  const words = KIND_NAMES[content.kind];
  if (invocation.arguments?.['entry'] !== undefined) {
    const entry = entryArgument(invocation);
    if ('refused' in entry) return entry.refused;
    sayWhenSettled(
      context,
      library.replace(entry.id, content),
      (kept) => `Replaced the ${words} ${quoted(kept.name)}.`,
    );
    return undefined;
  }
  const name = textArgument(invocation, 'name');
  if (name === undefined) return `Give the ${words} a name to save it under.`;
  sayWhenSettled(
    context,
    library.save(name, content),
    (kept) => `Saved the ${words} ${quoted(kept.name)} to your library.`,
  );
  return undefined;
}

function saveChainCommand(): Command<ShellContext> {
  return namingCommand(
    'library.save-chain',
    'Save a chain to your library',
    CommandCategory.Edit,
    (context, invocation) => {
      const reached = librarySession(context);
      if (typeof reached === 'string') return reached;
      const state = reached.session.getSnapshot().model.state;
      const chain = chainToSave(context, invocation, state);
      if (typeof chain === 'string') return chain;
      return keep(context, invocation, reached.library, { kind: 'chain', chain });
    },
    {
      availability: sessionAvailability,
      keywords: ['save', 'chain', 'rack', 'library', 'favourite', 'replace'],
      description:
        'Saves the rack of the asset or region shown, or the chain named, to your library under a name, or in place of a saved chain.',
      discoverable: false,
    },
  );
}

function savePresetCommand(): Command<ShellContext> {
  return namingCommand(
    'library.save-preset',
    'Save a processor’s settings as a preset',
    CommandCategory.Edit,
    (context, invocation) => {
      const reached = librarySession(context);
      if (typeof reached === 'string') return reached;
      const state = reached.session.getSnapshot().model.state;
      const named = processorArgument(context, invocation);
      const processor = named === undefined ? undefined : processorIn(state, named);
      if (processor === undefined) return 'Select one processor, or name it, to save its settings.';
      return keep(context, invocation, reached.library, { kind: 'preset', processor });
    },
    {
      availability: sessionAvailability,
      keywords: ['save', 'preset', 'processor', 'settings', 'library', 'replace'],
      description:
        'Saves the selected processor’s settings, or the named processor’s, as a preset in your library under a name, or in place of a preset.',
      discoverable: false,
    },
  );
}

function renameCommand(): Command<ShellContext> {
  return namingCommand(
    'library.rename',
    'Rename a saved chain or preset',
    CommandCategory.Edit,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const entry = entryArgument(invocation);
      if ('refused' in entry) return entry.refused;
      const name = textArgument(invocation, 'name');
      if (name === undefined) return 'Give the new name.';
      sayWhenSettled(
        context,
        stores.savedProcessing.rename(entry.id, name),
        (kept) => `Renamed it ${quoted(kept.name)}.`,
      );
      return undefined;
    },
    {
      availability: projectsAvailability,
      keywords: ['rename', 'chain', 'preset', 'library'],
      discoverable: false,
    },
  );
}

function removeCommand(): Command<ShellContext> {
  return shellCommand(
    'library.remove',
    'Remove a saved chain or preset',
    CommandCategory.Edit,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const entry = entryArgument(invocation);
      if ('refused' in entry) return entry.refused;
      sayWhenSettled(
        context,
        stores.savedProcessing.remove(entry.id),
        () => 'Removed it from your library. What it was applied to keeps its copy.',
      );
      return undefined;
    },
    {
      availability: projectsAvailability,
      keywords: ['remove', 'delete', 'chain', 'preset', 'library'],
      description:
        'Removes a saved chain or preset from your library for good; what it was applied to keeps its copy.',
      discoverable: false,
    },
  );
}

/** The commands that save to, rename in and remove from the library. */
export function libraryCommands(): readonly Command<ShellContext>[] {
  return [saveChainCommand(), savePresetCommand(), renameCommand(), removeCommand()];
}
