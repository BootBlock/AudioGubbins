/**
 * Deleting a project, restoring a deleted one, and purging one for good
 * (REQ-STOR-026, REQ-STOR-102).
 *
 * Deleting hides a project and keeps everything it held, so it needs no
 * confirmation; the one open here is closed first. Purging removes it for good,
 * and runs only with the deletion the person was shown, which the storage
 * checks.
 */

import {
  CommandCategory,
  unavailable,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import type { ProjectHeader } from '@audiogubbins/storage';

import type { ProjectStores } from '../state/project-stores.js';
import {
  idArgument,
  projectNameOf,
  projectsAvailability,
  readyProjects,
  sayWhenSettled,
} from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { quoted } from '@audiogubbins/text';

/** The project open here, or the one an argument names, or why there is neither. */
function projectMeant(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly id: ProjectId } | { readonly refused: string } {
  if (textArgument(invocation, 'project') !== undefined) {
    return idArgument<'ProjectId'>(invocation, 'project', 'project');
  }
  const open = context.projects?.project.get();
  return open?.kind === 'open' ? { id: open.snapshot.project } : { refused: 'No project is open.' };
}

function deleteProjectCommand(): Command<ShellContext> {
  return shellCommand(
    'file.delete-project',
    'Delete project',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const meant = projectMeant(context, invocation);
      if ('refused' in meant) return meant.refused;
      const project = meant.id;
      const name = projectNameOf(stores, project);
      sayWhenSettled(
        context,
        deleted(stores, project),
        () => `${name} is deleted. You can restore it from the Projects dialogue.`,
      );
      return undefined;
    },
    {
      keywords: ['project', 'delete', 'remove', 'bin', 'file'],
      availability: (context) => {
        const open = context.projects?.project.get();
        return open?.kind === 'open'
          ? projectsAvailability(context)
          : unavailable('No project is open.');
      },
    },
  );
}

function restoreProjectCommand(): Command<ShellContext> {
  return shellCommand(
    'file.restore-project',
    'Restore a deleted project',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const project = idArgument<'ProjectId'>(invocation, 'project', 'project');
      if ('refused' in project) return project.refused;
      sayWhenSettled(
        context,
        stores.library.restore(project.id),
        (header) => `${quoted(header.name)} is restored.`,
      );
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

function purgeProjectCommand(): Command<ShellContext> {
  return shellCommand(
    'file.purge-project',
    'Purge a deleted project',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const project = idArgument<'ProjectId'>(invocation, 'project', 'project');
      if ('refused' in project) return project.refused;
      const deletedAt = invocation.arguments?.['deletedAt'];
      if (typeof deletedAt !== 'number') return 'Confirm which deletion to purge.';
      const name = projectNameOf(stores, project.id);
      sayWhenSettled(
        context,
        stores.library.purge(project.id, deletedAt),
        () => `${name} is purged, and cannot be restored.`,
      );
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

/** Deleting, restoring and purging a project. */
export function deletionCommands(): readonly Command<ShellContext>[] {
  return [deleteProjectCommand(), restoreProjectCommand(), purgeProjectCommand()];
}

/** Deletes a project, closing it first where it is the one open. */
async function deleted(
  stores: ProjectStores,
  project: ProjectId,
): Promise<DomainResult<ProjectHeader>> {
  const open = stores.project.get();
  if (open.kind === 'open' && open.snapshot.project === project) {
    const closed = await stores.project.close();
    if (!closed.ok) return closed;
  }
  return await stores.library.remove(project);
}
