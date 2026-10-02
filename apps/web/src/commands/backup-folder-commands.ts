/**
 * The backups folder: choosing a folder on this machine that each backup is
 * also written to, giving the browser's leave to write into it again after a
 * reload, and letting it go (REQ-STOR-105).
 *
 * Each asks the browser as the first thing it does, in the handler of the
 * gesture that ran it, since the browser opens no picker and asks no question
 * outside one. Where the browser gives no folder to write into, each says so,
 * and that backups stay in the browser's own storage to be exported by hand.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';

import type { BackupFolderState } from '../state/backup-folder-store.js';
import { quoted } from '../wording.js';
import { readyProjects, sayWhenSettled } from './project-access.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Why no folder can be chosen in this browser. */
const NO_FOLDERS =
  'This browser cannot give AudioGubbins a folder to write into, so backups stay in its own storage. Export any of them from the list.';

/** The backups folder, or why nothing can be done with one now. */
function folderOf(context: ShellContext): BackupFolderState | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  const folder = stores.backupFolder.get();
  return folder.kind === 'unsupported' ? NO_FOLDERS : folder;
}

/** Available where a folder can be chosen here. */
function choosingAvailability(context: ShellContext): CommandAvailability {
  const folder = folderOf(context);
  return typeof folder === 'string' ? unavailable(folder) : AVAILABLE;
}

/** Available where a folder is chosen and, where `needsLeave`, cannot be written yet. */
function chosenAvailability(context: ShellContext, needsLeave: boolean): CommandAvailability {
  const folder = folderOf(context);
  if (typeof folder === 'string') return unavailable(folder);
  if (folder.kind !== 'chosen') return unavailable('No backups folder is chosen in this browser.');
  if (needsLeave && folder.access === 'granted') {
    return unavailable(`AudioGubbins may already write to ${quoted(folder.name)}.`);
  }
  return AVAILABLE;
}

/** What the folder now is, in a sentence. */
function folderSentence(folder: BackupFolderState): string {
  if (folder.kind !== 'chosen') return 'No backups folder is chosen.';
  switch (folder.access) {
    case 'granted':
      return `Backups are copied to ${quoted(folder.name)} as the backup settings ask.`;
    case 'permission-needed':
      return `The browser has not yet let AudioGubbins write to ${quoted(folder.name)} again.`;
    case 'denied':
      return `The browser refused to let AudioGubbins write to ${quoted(folder.name)}, so backups stay in its own storage.`;
  }
}

function chooseFolderCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.choose-folder',
    'Choose a backups folder…',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, stores.backupFolder.choose(), (folder) =>
        folder === undefined ? undefined : folderSentence(folder),
      );
      return undefined;
    },
    {
      keywords: ['backup', 'folder', 'directory', 'external', 'copy', 'disk'],
      availability: choosingAvailability,
    },
  );
}

function allowFolderCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.allow-folder',
    'Allow writing to the backups folder',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, stores.backupFolder.allow(), folderSentence);
      return undefined;
    },
    {
      keywords: ['backup', 'folder', 'permission', 'allow', 'grant', 'access'],
      availability: (context) => chosenAvailability(context, true),
    },
  );
}

function forgetFolderCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.forget-folder',
    'Stop copying backups to the folder',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(
        context,
        stores.backupFolder.forget(),
        () =>
          'Backups are no longer copied to a folder. The backups already in it are left as they are.',
      );
      return undefined;
    },
    {
      discoverable: false,
      availability: (context) => chosenAvailability(context, false),
    },
  );
}

/** Every command on the backups folder. */
export function backupFolderCommands(): readonly Command<ShellContext>[] {
  return [chooseFolderCommand(), allowFolderCommand(), forgetFolderCommand()];
}
