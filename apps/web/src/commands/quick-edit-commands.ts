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
 * A Quick Edit is the file made into a project, or nothing: where its file is
 * refused or its import is called off, the project made for it is removed for
 * good and the project open before is opened again, so a failed Quick Edit
 * leaves no empty project behind it.
 */

import {
  CommandCategory,
  unavailable,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { nameFromFile } from '@audiogubbins/project-format';

import { ONE_AT_A_TIME } from '../state/audio-imports.js';
import type { ProjectStores } from '../state/project-stores.js';
import { quoted } from '../wording.js';
import { openedSentence } from './audio-import-commands.js';
import { projectsAvailability, readyProjects, sayWhenSettled } from './project-access.js';
import { madeAndOpened, settingsFrom } from './project-file-commands.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The project open here before a Quick Edit, and how, to open again if it fails. */
interface Before {
  readonly project: ProjectId;
  readonly access: 'write' | 'read';
}

const NOT_WRITABLE = failure(
  'quick-edit.not-writable',
  FailureKind.Conflict,
  'The project made for the Quick Edit did not open to change, so nothing was kept.',
);

/** The project open here now, and how, or `undefined` where none is. */
function openBefore(stores: ProjectStores): Before | undefined {
  const open = stores.project.get();
  if (open.kind !== 'open') return undefined;
  return {
    project: open.snapshot.project,
    access: stores.project.session() === undefined ? 'read' : 'write',
  };
}

/**
 * Removes the project `made` for good, and opens `before` again where there
 * was one. A removal that fails leaves the project in the bin, which says so.
 */
async function withdrawn(
  stores: ProjectStores,
  made: ProjectId,
  before: Before | undefined,
): Promise<DomainResult<void>> {
  const closed = await stores.project.close();
  if (!closed.ok) return closed;
  const removed = await stores.library.remove(made);
  if (!removed.ok) return removed;
  const { deleted } = removed.value;
  if (deleted !== undefined) {
    const purged = await stores.library.purge(made, deleted);
    if (!purged.ok) return purged;
  }
  if (before === undefined) return succeed(undefined);
  const reopened = await stores.project.open(before.project, { access: before.access });
  return reopened.ok ? succeed(undefined) : reopened;
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
  const before = openBefore(stores);
  const made = await madeAndOpened(context, stores, name.value, settings.value);
  if (!made.ok) return made;
  const session = stores.project.session();
  const outcome =
    session === undefined
      ? fail(NOT_WRITABLE)
      : await stores.imports.importChosen(
          session,
          file,
          context.ids.next<'AssetId'>(),
          context.clock,
        );
  if (outcome.ok && outcome.value.kind === 'imported') {
    const { imported } = outcome.value;
    stores.quickEdit.hold({
      project: made.value.id,
      asset: imported.asset.id,
      fileName: file.fileName,
    });
    const opened = await openedSentence(context, imported);
    return succeed(`${opened} It is kept in a project of its own, ${quoted(made.value.name)}.`);
  }
  const undone = await withdrawn(stores, made.value.id, before);
  if (!undone.ok) return undone;
  return outcome.ok
    ? succeed(`The Quick Edit of ${quoted(file.fileName)} was cancelled, and nothing was kept.`)
    : outcome;
}

function quickEditCommand(): Command<ShellContext> {
  return shellCommand(
    'file.quick-edit',
    'Quick Edit a file…',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      if (stores.imports.get().kind === 'importing') return ONE_AT_A_TIME.summary;
      sayWhenSettled(context, quickEdited(context, stores, invocation), (said) => said);
      return undefined;
    },
    {
      keywords: ['quick', 'edit', 'open', 'file', 'audio', 'wav', 'aiff'],
      description:
        'Opens an audio file to edit straight away, in a project of its own named after it.',
      availability: (context) => {
        const ready = projectsAvailability(context);
        if (!ready.available) return ready;
        return context.projects?.imports.get().kind === 'importing'
          ? unavailable(ONE_AT_A_TIME.summary)
          : ready;
      },
    },
  );
}

/** Quick Edit: a file made into a project of its own and opened. */
export function quickEditCommands(): readonly Command<ShellContext>[] {
  return [quickEditCommand()];
}
