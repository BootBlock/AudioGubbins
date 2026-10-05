/**
 * Quick Edit (REQ-EDIT-008, ADR-0053): choosing a file makes a project named
 * after it, imports the file into it as the person's setting for bringing
 * files in says, and opens it in the editor, with no project dialogue.
 *
 * A facade over the project model, never a model of its own: the project is
 * made and opened as "Make a new project" makes one, the file is imported by
 * the one import path, and every edit after is the project command Project
 * Mode runs. The shell holds the Quick Edit while its project is open
 * (`QuickEditStore`).
 *
 * A Quick Edit is the file made into a project, or nothing: where the project
 * made for it cannot be opened, or its file is refused, or its import is
 * called off or fails, that project is removed for good and the project open
 * before is opened again where nothing else took its place, so a failed Quick
 * Edit leaves no empty project behind it.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  combine,
  fail,
  failure,
  mapResult,
  succeed,
  type DomainFailureResult,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { nameFromFile } from '@audiogubbins/project-format';
import type { ImportedAudio, ProjectHeader } from '@audiogubbins/storage';
import type { PageFile } from '@audiogubbins/storage-runtime';

import type { ProjectStores } from '../state/project-stores.js';
import { openedSentence, whileNoImportRuns } from './audio-import-commands.js';
import { projectsAvailability, readyProjects, sayWhenSettled } from './project-access.js';
import { openedMade, settingsFrom } from './project-file-commands.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { quoted } from '@audiogubbins/text';

/** A project open here, and how. */
interface OpenHere {
  readonly project: ProjectId;
  readonly access: 'write' | 'read';
}

/** What making the chosen file into the project made for it came to. */
type Attempt =
  | { readonly kind: 'kept'; readonly imported: ImportedAudio }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly failed: DomainFailureResult };

const NOT_WRITABLE = failure(
  'quick-edit.not-writable',
  FailureKind.Conflict,
  'The project made for the Quick Edit did not open to change, so nothing was kept.',
);

/** The project open here now, and how, or `undefined` where none is. */
function openHere(stores: ProjectStores): OpenHere | undefined {
  const open = stores.project.get();
  if (open.kind !== 'open') return undefined;
  return {
    project: open.snapshot.project,
    access: stores.project.session() === undefined ? 'read' : 'write',
  };
}

/** Removes `project`, which is not open, for good. */
async function removedForGood(
  stores: ProjectStores,
  project: ProjectId,
): Promise<DomainResult<void>> {
  const removed = await stores.library.remove(project);
  if (!removed.ok) return removed;
  const { deleted } = removed.value;
  return deleted === undefined ? succeed(undefined) : await stores.library.purge(project, deleted);
}

/**
 * Removes the project `made` for good, closing it first where it is open
 * here, and opens `before` again where nothing is open in its place. A
 * removal that fails leaves the project in the bin, which says so, and the
 * project before is opened all the same.
 */
async function withdrawn(
  stores: ProjectStores,
  made: ProjectId,
  before: OpenHere | undefined,
): Promise<DomainResult<void>> {
  if (openHere(stores)?.project === made) {
    const closed = await stores.project.close();
    // Still open, the project can be neither removed nor replaced.
    if (!closed.ok) return closed;
  }
  const removed = await removedForGood(stores, made);
  if (before === undefined || stores.project.get().kind !== 'none') return removed;
  const reopened = await stores.project.open(before.project, { access: before.access });
  return mapResult(combine<unknown>([removed, reopened]), () => undefined);
}

/** Opens the project `made` and imports `file` into it, holding the Quick Edit where it is. */
async function attempted(
  context: ShellContext,
  stores: ProjectStores,
  made: ProjectHeader,
  file: PageFile,
): Promise<Attempt> {
  const opened = await openedMade(context, stores, made);
  if (!opened.ok) return { kind: 'failed', failed: opened };
  const session = stores.project.session();
  if (session === undefined) return { kind: 'failed', failed: fail(NOT_WRITABLE) };
  const outcome = await stores.imports.importChosen(
    session,
    file,
    context.ids.next<'AssetId'>(),
    context.clock,
  );
  if (!outcome.ok) return { kind: 'failed', failed: outcome };
  if (outcome.value.kind === 'cancelled') return { kind: 'cancelled' };
  const { imported } = outcome.value;
  stores.quickEdit.hold({ project: made.id, asset: imported.asset.id, fileName: file.fileName });
  return { kind: 'kept', imported };
}

/** Makes the chosen file a project and opens it; or nothing, where it cannot be. */
async function quickEdited(
  context: ShellContext,
  stores: ProjectStores,
  invocation: CommandInvocation,
): Promise<DomainResult<string | undefined>> {
  const file = await stores.files.chooseMediaFile();
  if (file === undefined) return succeed(undefined);
  const name = nameFromFile('project', file.fileName);
  if (!name.ok) return name;
  const settings = settingsFrom(invocation);
  if (!settings.ok) return settings;
  const before = openHere(stores);
  const made = await stores.library.create({ name: name.value, settings: settings.value });
  if (!made.ok) return made;
  let attempt: Attempt | undefined;
  try {
    attempt = await attempted(context, stores, made.value, file);
  } finally {
    // An attempt that threw leaves no project behind it either.
    if (attempt === undefined) await withdrawn(stores, made.value.id, before);
  }
  if (attempt.kind === 'kept') {
    const opened = await openedSentence(context, attempt.imported);
    return succeed(`${opened} It is kept in a project of its own, ${quoted(made.value.name)}.`);
  }
  const undone = await withdrawn(stores, made.value.id, before);
  if (attempt.kind === 'failed') {
    return undone.ok ? attempt.failed : fail(...attempt.failed.failures, ...undone.failures);
  }
  if (!undone.ok) return undone;
  return succeed(`The Quick Edit of ${quoted(file.fileName)} was cancelled, and nothing was kept.`);
}

function quickEditCommand(): Command<ShellContext> {
  return shellCommand(
    'file.quick-edit',
    'Quick Edit a file…',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, quickEdited(context, stores, invocation), (said) => said);
      return undefined;
    },
    {
      keywords: ['quick', 'edit', 'open', 'file', 'audio', 'wav', 'aiff'],
      description:
        'Opens an audio file to edit straight away, in a project of its own named after it.',
      availability: (context) => whileNoImportRuns(context, projectsAvailability(context)),
    },
  );
}

/** Quick Edit: a file made into a project of its own and opened. */
export function quickEditCommands(): readonly Command<ShellContext>[] {
  return [quickEditCommand()];
}
