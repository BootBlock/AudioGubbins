/**
 * Taking a project out and bringing one in: a portable bundle, an unpacked
 * folder for a repository, and copying linked files into the project so it is
 * whole (REQ-STOR-099, REQ-STOR-103, REQ-STOR-166).
 *
 * Each command asks for its file or folder as the first thing it does, in the
 * handler of the gesture that ran it, since a browser opens no chooser
 * otherwise. A bundle holds the whole history unless it is asked for the state
 * alone, and then keeps the provenance at the level asked for.
 */

import {
  CommandCategory,
  unavailable,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { ProvenanceLevel } from '@audiogubbins/project-format';
import type { AssetConsolidation, CopyOptions, PassedOverReason } from '@audiogubbins/storage';

import type { RecordedExport } from '../state/export-recorder.js';
import { quoted } from '../wording.js';
import {
  projectsAvailability,
  readyProjects,
  sayWhenSettled,
  sessionAvailability,
  sessionOf,
} from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** How much of the project a bundle or folder holds, as the arguments ask. */
function copyOptionsFrom(invocation: CommandInvocation): CopyOptions | string {
  const includeCaches = invocation.arguments?.['caches'] === true;
  if (textArgument(invocation, 'scope') !== 'current-state') {
    return { scope: { kind: 'whole-history' }, includeCaches };
  }
  const named = textArgument(invocation, 'provenance') ?? ProvenanceLevel.Full;
  const provenance = Object.values(ProvenanceLevel).find((level) => level === named);
  return provenance === undefined
    ? `There is no provenance level ${named}.`
    : { scope: { kind: 'current-state', provenance }, includeCaches };
}

/** The project open here, and the name it goes by, or why there is none. */
function openProject(context: ShellContext) {
  const open = context.projects?.project.get();
  return open?.kind === 'open'
    ? { project: open.snapshot.project, name: open.snapshot.model.state.project.displayName }
    : 'No project is open.';
}

/**
 * Whether the export is kept in the project's history, where it is not: an
 * export changes no state, so undo cannot take its file back, and its
 * provenance is recorded instead (REQ-STOR-197, REQ-STOR-198).
 */
export function recordedNote(recorded: RecordedExport): string {
  switch (recorded) {
    case 'kept':
      return '';
    case 'not-writable':
      return ' Its history does not record the export, because this tab cannot change the project.';
    case 'failed':
      return ' Its history could not record the export.';
  }
}

/** What a copy of a project could not carry, where it could not carry something. */
function linkedNote(linked: readonly unknown[]): string {
  return linked.length === 0
    ? ''
    : ` ${String(linked.length)} linked ${linked.length === 1 ? 'file is' : 'files are'} not in it; copy linked files into the project first to carry them.`;
}

function exportBundleCommand(): Command<ShellContext> {
  return shellCommand(
    'file.export-bundle',
    'Export as a bundle…',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const open = openProject(context);
      if (typeof open === 'string') return open;
      const options = copyOptionsFrom(invocation);
      if (typeof options === 'string') return options;
      const work = stores.transfer.exportBundle(open.project, open.name, options);
      sayWhenSettled(context, work, (exported) =>
        exported === undefined
          ? undefined
          : `${quoted(open.name)} is exported as a bundle.${linkedNote(exported.linked)}${recordedNote(exported.recorded)}`,
      );
      return undefined;
    },
    {
      keywords: ['export', 'bundle', 'zip', 'save', 'share', 'portable', 'file'],
      availability: (context) =>
        typeof openProject(context) === 'string'
          ? unavailable('No project is open.')
          : projectsAvailability(context),
    },
  );
}

function exportFolderCommand(): Command<ShellContext> {
  return shellCommand(
    'file.export-folder',
    'Export to a folder…',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const open = openProject(context);
      if (typeof open === 'string') return open;
      const options = copyOptionsFrom(invocation);
      if (typeof options === 'string') return options;
      sayWhenSettled(context, stores.transfer.exportFolder(open.project, options), (exported) =>
        exported === undefined
          ? undefined
          : `${quoted(open.name)} is exported to the folder.${linkedNote(exported.linked)}${recordedNote(exported.recorded)}`,
      );
      return undefined;
    },
    {
      keywords: ['export', 'folder', 'unpacked', 'git', 'repository', 'file'],
      availability: (context) => {
        if (typeof openProject(context) === 'string') return unavailable('No project is open.');
        return context.projects?.files.chooseFolderToWrite === undefined
          ? unavailable(
              'This browser cannot give AudioGubbins a folder to write into. Export a bundle instead.',
            )
          : projectsAvailability(context);
      },
    },
  );
}

/** Taking the open project out. */
function exportCommands(): readonly Command<ShellContext>[] {
  return [exportBundleCommand(), exportFolderCommand()];
}

/** What bringing a project in came to, in a sentence, or nothing where nothing was chosen. */
function importedSentence(
  value: { readonly header: { readonly name: string }; readonly asCopy: boolean } | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return value.asCopy
    ? `${quoted(value.header.name)} is brought in as a copy, since this browser already keeps that project.`
    : `${quoted(value.header.name)} is brought in.`;
}

function importBundleCommand(): Command<ShellContext> {
  return shellCommand(
    'file.import-bundle',
    'Import a bundle…',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, stores.transfer.importBundle(), importedSentence);
      return undefined;
    },
    {
      keywords: ['import', 'bundle', 'zip', 'open', 'bring in', 'file'],
      availability: projectsAvailability,
    },
  );
}

function importFolderCommand(): Command<ShellContext> {
  return shellCommand(
    'file.import-folder',
    'Import a folder…',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, stores.transfer.importFolder(), importedSentence);
      return undefined;
    },
    {
      keywords: ['import', 'folder', 'unpacked', 'git', 'repository', 'file'],
      availability: projectsAvailability,
    },
  );
}

/** Why linked files were not copied, as the person is told it, by the reason. */
const PASSED_OVER_WORDS: Readonly<Record<PassedOverReason, string>> = {
  changed: 'changed since the project used it',
  'not-found': 'cannot be found',
  unreadable: 'cannot be found',
  'access-needed': 'need your leave to be read, which copying again asks for',
  'permission-refused': 'were refused leave to be read',
};

/** What copying linked files into the project came to, in a sentence. */
function consolidatedSentence(outcomes: readonly AssetConsolidation[]): string {
  const copied = outcomes.filter((one) => one.kind === 'consolidated').length;
  const left = new Map<string, number>();
  for (const outcome of outcomes) {
    const words =
      outcome.kind === 'passed-over'
        ? PASSED_OVER_WORDS[outcome.reason]
        : outcome.kind === 'failed'
          ? 'could not be stored'
          : undefined;
    if (words !== undefined) left.set(words, (left.get(words) ?? 0) + 1);
  }
  if (left.size === 0) {
    return `${String(copied)} linked ${copied === 1 ? 'file is' : 'files are'} copied into the project.`;
  }
  const why = [...left].map(([words, count]) => `${String(count)} ${words}`).join('; ');
  return `${String(copied)} copied. Not copied: ${why}.`;
}

function consolidateCommand(): Command<ShellContext> {
  return shellCommand(
    'file.consolidate',
    'Copy linked files into the project',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      const session = sessionOf(context);
      if (typeof stores === 'string') return stores;
      if (typeof session === 'string') return session;
      sayWhenSettled(context, stores.transfer.consolidate(session), consolidatedSentence);
      return undefined;
    },
    {
      keywords: ['consolidate', 'copy', 'linked', 'self-contained', 'materialise', 'file'],
      availability: sessionAvailability,
    },
  );
}

/** Bringing a project in, and making the open one whole. */
function importCommands(): readonly Command<ShellContext>[] {
  return [importBundleCommand(), importFolderCommand(), consolidateCommand()];
}

/** Every command that takes a project out or brings one in. */
export function projectTransferCommands(): readonly Command<ShellContext>[] {
  return [...exportCommands(), ...importCommands()];
}
