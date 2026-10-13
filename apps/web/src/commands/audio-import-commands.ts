/**
 * Bringing audio files into the open project, one or several or a folder's,
 * calling it off, and clearing the list of what was brought in
 * (REQ-STOR-025, REQ-AUDIO-220, ADR-0052, ADR-0090).
 *
 * The first file brought in opens in the editor last in use, or a new one
 * where none is, once the page holds its file, so the person sees what they
 * imported where they were working. A file the header says is longer than it
 * is was read to its last whole frame, and the person is told by how much it
 * fell short. One file is spoken of as itself; a batch says how many of its
 * files were imported, names each refused with its reason up to a few, the
 * list of files being imported naming every one, and says what a cancel kept.
 */

import {
  CommandCategory,
  unavailable,
  AVAILABLE,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { ImportedAudio } from '@audiogubbins/storage';
import { counted, quoted } from '@audiogubbins/text';

import { assetEntryId } from '../assets/project-entry.js';
import { IMPORT_EXPORT_MENU } from '../import-export-words.js';
import { settledEntry } from '../state/asset-catalogue.js';
import {
  ONE_AT_A_TIME,
  type ImportBatchOutcome,
  type ImportBatches,
  type ImportTarget,
} from '../state/import-batches.js';
import { showInEditor } from './editor-asset-commands.js';
import { ImportCommand } from './import-export-ids.js';
import { readyProjects, sayWhenSettled, sessionAvailability, sessionOf } from './project-access.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** An import that ended, with each file's outcome. */
type EndedImport = Extract<ImportBatchOutcome, { readonly kind: 'ended' }>;

/** The most refused files a batch's sentence names; the list names every one. */
const NAMED_REFUSALS = 3;

const NOTHING_IMPORTING = 'No file is being imported.';
const NOTHING_LISTED = 'No import is listed.';

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
 * Available where `ready` is, and no file is being imported: one batch is
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

/** What a batch of several files came to, in sentences, once its first import is open. */
async function batchSentence(
  context: ShellContext,
  { batch, codecsUnready }: EndedImport,
): Promise<string> {
  const { job, outcomes } = batch;
  const imported = outcomes.flatMap((outcome) =>
    outcome.kind === 'imported' ? [outcome.imported] : [],
  );
  const refused = outcomes.flatMap((outcome, index) =>
    outcome.kind === 'refused'
      ? [`${quoted(job.entries[index]?.file.name ?? '')}: ${outcome.failure.summary}`]
      : [],
  );
  const cancelled = outcomes.filter((outcome) => outcome.kind === 'cancelled').length;
  const said = [
    `${String(imported.length)} of ${counted(outcomes.length, 'file', 'files')} imported.`,
  ];
  if (refused.length > 0) {
    const unnamed = refused.length - NAMED_REFUSALS;
    const more = unnamed > 0 ? ` And ${String(unnamed)} more, each listed with its reason.` : '';
    said.push(`Refused: ${refused.slice(0, NAMED_REFUSALS).join(' ')}${more}`);
    if (codecsUnready !== undefined) {
      said.push(`Compressed files cannot be decoded here: ${codecsUnready.summary}`);
    }
  }
  if (cancelled > 0) {
    said.push(
      `The import was cancelled, and nothing of the ${counted(cancelled, 'file', 'files')} not yet imported was kept.`,
    );
  }
  const [first] = imported;
  if (first !== undefined) said.push(await openedSentence(context, first));
  return said.join(' ');
}

/** What one file's import came to: imported and open, refused with its reason, or cancelled. */
async function fileSentence(
  context: ShellContext,
  { batch, codecsUnready }: EndedImport,
): Promise<DomainResult<string>> {
  const [only] = batch.outcomes;
  const name = quoted(batch.job.entries[0]?.file.name ?? '');
  switch (only?.kind) {
    case 'imported':
      return succeed(await openedSentence(context, only.imported));
    case 'refused':
      return codecsUnready === undefined ? fail(only.failure) : fail(only.failure, codecsUnready);
    case 'cancelled':
    case undefined:
      return succeed(`The import of ${name} was cancelled, and nothing was kept.`);
  }
}

/** What an import came to, in sentences, once its first asset is open where it can be. */
async function importedSentence(
  context: ShellContext,
  work: Promise<DomainResult<ImportBatchOutcome>>,
): Promise<DomainResult<string | undefined>> {
  const result = await work;
  if (!result.ok) return result;
  const outcome = result.value;
  if (outcome.kind === 'dismissed') return succeed(undefined);
  return outcome.batch.outcomes.length === 1
    ? await fileSentence(context, outcome)
    : succeed(await batchSentence(context, outcome));
}

/** A command that asks for files through `start` and imports them into the open project. */
function importCommand(
  id: string,
  label: string,
  keywords: readonly string[],
  start: (
    imports: ImportBatches,
    target: ImportTarget,
  ) => Promise<DomainResult<ImportBatchOutcome>>,
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const work = start(stores.imports, {
        session,
        ids: context.ids,
        clock: context.clock,
        codecs: context.codecs,
      });
      sayWhenSettled(context, importedSentence(context, work), (said) => said);
      return undefined;
    },
    {
      keywords,
      availability: (context) => whileNoImportRuns(context, sessionAvailability(context)),
    },
  );
}

function cancelImportCommand(): Command<ShellContext> {
  return shellCommand(
    'file.cancel-import',
    'Cancel the import',
    CommandCategory.File,
    (context) => (context.projects?.imports.cancel() === true ? undefined : NOTHING_IMPORTING),
    {
      keywords: ['cancel', 'stop', 'import', 'audio'],
      availability: (context) =>
        context.projects?.imports.get().kind === 'importing'
          ? AVAILABLE
          : unavailable(NOTHING_IMPORTING),
    },
  );
}

function clearImportsCommand(): Command<ShellContext> {
  return shellCommand(
    'file.clear-imports',
    'Clear the list of files imported',
    CommandCategory.File,
    (context) => (context.projects?.imports.clear() === true ? undefined : NOTHING_LISTED),
    {
      keywords: ['clear', 'dismiss', 'close', 'import', 'list', 'files'],
      availability: (context) =>
        context.projects?.imports.get().kind === 'ended' ? AVAILABLE : unavailable(NOTHING_LISTED),
    },
  );
}

/** Bringing audio into the open project. */
export function audioImportCommands(): readonly Command<ShellContext>[] {
  return [
    importCommand(
      ImportCommand.Files,
      IMPORT_EXPORT_MENU.importFiles,
      ['import', 'audio', 'file', 'files', 'wav', 'flac', 'mp3', 'ogg', 'sound', 'bring in', 'add'],
      (imports, target) => imports.importFiles(target),
    ),
    importCommand(
      ImportCommand.Folder,
      IMPORT_EXPORT_MENU.importFolder,
      ['import', 'audio', 'folder', 'directory', 'batch', 'sounds', 'bring in', 'add'],
      (imports, target) => imports.importFolder(target),
    ),
    cancelImportCommand(),
    clearImportsCommand(),
  ];
}
