/**
 * Bringing an audio file into the open project, and calling it off
 * (REQ-STOR-025, REQ-AUDIO-220, ADR-0052).
 *
 * A file brought in opens in the editor last in use, or a new one where none
 * is, once the page holds its file, so the person sees what they imported
 * where they were working. A file the header says is longer than it is was
 * read to its last whole frame, and the person is told by how much it fell
 * short.
 */

import {
  CommandCategory,
  unavailable,
  AVAILABLE,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import { succeed, type DomainResult } from '@audiogubbins/domain';
import type { ImportedAudio } from '@audiogubbins/storage';
import { counted, quoted } from '@audiogubbins/text';

import { assetEntryId } from '../assets/project-entry.js';
import { settledEntry } from '../state/asset-catalogue.js';
import { ONE_AT_A_TIME, type AudioImportOutcome } from '../state/audio-imports.js';
import { showInEditor } from './editor-asset-commands.js';
import { readyProjects, sayWhenSettled, sessionAvailability, sessionOf } from './project-access.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What is said of a file read short, where it was. */
function shortfallSentence({ shortfall }: ImportedAudio): string {
  return shortfall === 0
    ? ''
    : ` Its audio ends ${counted(shortfall, 'frame', 'frames')} before its header says it does, so it was read to its last whole frame.`;
}

/**
 * Opens the asset `imported` made in the editor last in use, or a new one,
 * once the page holds its file, and answers what is said of it.
 */
export async function openedSentence(
  context: ShellContext,
  imported: ImportedAudio,
): Promise<string> {
  const name = quoted(imported.asset.displayName);
  const shortfall = shortfallSentence(imported);
  const scope = context.projects?.project.scope();
  if (scope === undefined) return `${name} is imported.${shortfall}`;
  const entry = await settledEntry(context.assets, assetEntryId(imported.asset.id), scope);
  if ('reason' in entry) return `${name} is imported, but cannot be shown yet. ${entry.reason}`;
  const refused = showInEditor(context, entry, context.editorViews.get().focused);
  if (refused !== undefined) return `${name} is imported.${shortfall} ${refused}`;
  return `${name} is imported and open.${shortfall}`;
}

/**
 * Available where `ready` is, and no file is being imported: one file is
 * brought in at a time, so nothing that brings one in is offered while one is.
 */
export function whileNoImportRuns(
  context: ShellContext,
  ready: CommandAvailability,
): CommandAvailability {
  if (!ready.available) return ready;
  return context.projects?.imports.get().kind === 'importing'
    ? unavailable(ONE_AT_A_TIME.summary)
    : ready;
}

/** What an import came to, in a sentence, once its asset is open where it can be. */
async function importedSentence(
  context: ShellContext,
  work: Promise<DomainResult<AudioImportOutcome>>,
): Promise<DomainResult<string | undefined>> {
  const result = await work;
  if (!result.ok) return result;
  const outcome = result.value;
  switch (outcome.kind) {
    case 'dismissed':
      return succeed(undefined);
    case 'cancelled':
      return succeed(
        `The import of ${quoted(outcome.fileName)} was cancelled, and nothing was kept.`,
      );
    case 'imported':
      return succeed(await openedSentence(context, outcome.imported));
  }
}

function importAudioCommand(): Command<ShellContext> {
  return shellCommand(
    'file.import-audio',
    'Import audio…',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const work = stores.imports.importAudio(
        session,
        context.ids.next<'AssetId'>(),
        context.clock,
      );
      sayWhenSettled(context, importedSentence(context, work), (said) => said);
      return undefined;
    },
    {
      keywords: ['import', 'audio', 'file', 'wav', 'aiff', 'sound', 'bring in', 'add'],
      availability: (context) => whileNoImportRuns(context, sessionAvailability(context)),
    },
  );
}

function cancelImportCommand(): Command<ShellContext> {
  return shellCommand(
    'file.cancel-import',
    'Cancel the import',
    CommandCategory.File,
    (context) => {
      if (context.projects?.imports.cancel() !== true) return 'No file is being imported.';
      return undefined;
    },
    {
      keywords: ['cancel', 'stop', 'import', 'audio'],
      availability: (context) =>
        context.projects?.imports.get().kind === 'importing'
          ? AVAILABLE
          : unavailable('No file is being imported.'),
    },
  );
}

/** Bringing audio into the open project. */
export function audioImportCommands(): readonly Command<ShellContext>[] {
  return [importAudioCommand(), cancelImportCommand()];
}
