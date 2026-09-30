/**
 * The files a project links to: the default way files are brought in, and the
 * answer to a linked file that changed, went or was replaced, including a file
 * chosen in its place that is not the one recorded, and the leave to read one
 * the browser asks the person for again (REQ-STOR-025, REQ-STOR-053,
 * REQ-STOR-104).
 */

import { CommandCategory, unavailable, type Command } from '@audiogubbins/commands';
import type { ResolutionKind } from '@audiogubbins/media-store';

import { SourceHandling } from '../state/project-preferences-store.js';
import type { GivenAccess, OfferedFile } from '../state/source-changes.js';
import {
  idArgument,
  projectsAvailability,
  readyProjects,
  sayWhenSettled,
} from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

function sourceHandlingCommand(): Command<ShellContext> {
  return shellCommand(
    'settings.source-handling',
    'Choose how files are brought in',
    CommandCategory.Settings,
    (context, invocation) => {
      const preferences = context.projects?.preferences;
      if (preferences === undefined) return 'This browser cannot keep projects.';
      const named = textArgument(invocation, 'handling');
      const handling = Object.values(SourceHandling).find((one) => one === named);
      if (handling === undefined) return 'Choose to copy files or to link them.';
      const refused = preferences.setSourceHandling(handling);
      if (refused !== undefined) return refused;
      context.interaction.announce(
        handling === SourceHandling.Copy
          ? 'Files are copied into the project from now on.'
          : 'Files are linked where they lie from now on.',
      );
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

function resolveCommand(): Command<ShellContext> {
  return shellCommand(
    'source.resolve',
    'Answer a change to a linked file',
    CommandCategory.Edit,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const asset = idArgument<'AssetId'>(invocation, 'asset', 'asset');
      if ('refused' in asset) return asset.refused;
      const named = textArgument(invocation, 'choice');
      const kinds: readonly ResolutionKind[] = ['adopt', 'relink', 'freeze', 'keep-offline'];
      const choice = kinds.find((one) => one === named);
      if (choice === undefined) return 'Choose what to do about the file.';
      sayWhenSettled(context, stores.sources.resolve(asset.id, choice), (resolution) => {
        if (resolution.kind === 'offered') return offeredSentence(resolution.offered);
        return choice === 'keep-offline'
          ? 'The asset stays offline until you choose again.'
          : 'Done.';
      });
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

/** What is said of a chosen file that is not the one the project used. */
export function offeredSentence(offered: OfferedFile): string {
  const how =
    offered.difference === 'replaced' ? 'it is another kind of file' : 'its content differs';
  return `The file you chose is not the one the project used: ${how}. Link it anyway, or choose another file.`;
}

function linkOfferedCommand(): Command<ShellContext> {
  return shellCommand(
    'source.link-offered',
    'Link the chosen file anyway',
    CommandCategory.Edit,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const asset = idArgument<'AssetId'>(invocation, 'asset', 'asset');
      if ('refused' in asset) return asset.refused;
      sayWhenSettled(context, stores.sources.linkOffered(asset.id), () => 'Done.');
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

/** What giving leave to read a linked file came to, in a sentence. */
function givenSentence(given: GivenAccess): string {
  switch (given.kind) {
    case 'as-recorded':
      return 'The file is as the project recorded it, and the asset plays again.';
    case 'changed':
      return 'The file can be read, but it is not what the project recorded. Choose what to do about it.';
    case 'applied':
      return 'The file is not what the project recorded, so the asset was dealt with as its own setting says.';
    case 'not-given':
      return given.refused
        ? 'Leave to read the file was refused, so the asset stays offline unless you choose another file.'
        : 'The browser did not ask for leave to read the file. Press Give access again.';
  }
}

function giveAccessCommand(): Command<ShellContext> {
  return shellCommand(
    'source.give-access',
    'Give access to a linked file',
    CommandCategory.Edit,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const asset = idArgument<'AssetId'>(invocation, 'asset', 'asset');
      if ('refused' in asset) return asset.refused;
      sayWhenSettled(context, stores.sources.giveAccess(asset.id), givenSentence);
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

function decideLaterCommand(): Command<ShellContext> {
  return shellCommand(
    'source.decide-later',
    'Decide later about changed linked files',
    CommandCategory.Edit,
    (context) => {
      context.projects?.sources.putAside();
      context.interaction.announce(
        'The changed files are left as they are, and their assets stay offline until the project is opened again.',
      );
    },
    {
      discoverable: false,
      availability: (context) => {
        const waiting = context.projects?.sources.get();
        return waiting === undefined || waiting.changes.length + waiting.applied.length === 0
          ? unavailable('No linked file is waiting for an answer.')
          : projectsAvailability(context);
      },
    },
  );
}

/** How files are brought in, and what is done about one that changed. */
export function sourceCommands(): readonly Command<ShellContext>[] {
  return [
    sourceHandlingCommand(),
    resolveCommand(),
    linkOfferedCommand(),
    giveAccessCommand(),
    decideLaterCommand(),
  ];
}
