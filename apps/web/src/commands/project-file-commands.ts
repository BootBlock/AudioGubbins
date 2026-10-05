/**
 * What a person does to their projects as a whole: the Projects dialogue,
 * making, opening, closing, renaming, deleting, restoring and purging a
 * project, and forking one from a point in its history (REQ-STOR-026,
 * REQ-STOR-102, REQ-STOR-199, REQ-STOR-021).
 *
 * Each is a command, so the File menu, the palette, the dialogue and a future
 * macro take one route (REQ-EDIT-073). A command that needs a name takes it as
 * an argument, which the dialogue supplies; the menu opens the dialogue at the
 * section that asks for it. Renaming is the project command of that name,
 * through the session, so undo reverses it like any change.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  StandardLayouts,
  mapResult,
  sampleRate,
  type DomainResult,
  type ProjectSettings,
} from '@audiogubbins/domain';
import { ProjectCommandId } from '@audiogubbins/project-commands';
import { givenName } from '@audiogubbins/project-format';
import type { ProjectHeader } from '@audiogubbins/storage';

import { ProjectsSection } from '../state/interaction-store.js';
import { quoted } from '../wording.js';
import type { ProjectStores } from '../state/project-stores.js';
import {
  idArgument,
  projectNameOf,
  projectsAvailability,
  readyProjects,
  sayWhenSettled,
  sessionAvailability,
  sessionOf,
} from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The settings of a new project: the sample rate and channels asked for, or the usual ones. */
export function settingsFrom(invocation: CommandInvocation): DomainResult<ProjectSettings> {
  const rate = invocation.arguments?.['sampleRate'];
  const mono = invocation.arguments?.['channels'] === 'mono';
  return mapResult(sampleRate(typeof rate === 'number' ? rate : 48_000), (value) => ({
    sampleRate: value,
    channelLayout: mono ? StandardLayouts.mono : StandardLayouts.stereo,
  }));
}

/** Makes a project and opens it, closing the dialogue once it is open. */
export async function madeAndOpened(
  context: ShellContext,
  stores: ProjectStores,
  name: string,
  settings: ProjectSettings,
): Promise<DomainResult<ProjectHeader>> {
  const made = await stores.library.create({ name, settings });
  if (!made.ok) return made;
  const opened = await stores.project.open(made.value.id);
  if (!opened.ok) return opened;
  context.interaction.setProjectsSection(undefined);
  return made;
}

function projectsCommand(): Command<ShellContext> {
  return shellCommand(
    'file.projects',
    'Projects…',
    CommandCategory.File,
    (context, invocation) => {
      const named = textArgument(invocation, 'section') ?? ProjectsSection.Open;
      const section = Object.values(ProjectsSection).find((one) => one === named);
      if (section === undefined) return `The Projects dialogue has no section ${named}.`;
      context.interaction.setProjectsSection(section);
      return undefined;
    },
    {
      keywords: ['project', 'projects', 'new', 'open', 'import', 'rename', 'fork', 'file'],
      availability: projectsAvailability,
    },
  );
}

function closeProjectsCommand(): Command<ShellContext> {
  return shellCommand(
    'file.close-projects',
    'Close the Projects dialogue',
    CommandCategory.File,
    (context) => {
      context.interaction.setProjectsSection(undefined);
    },
    {
      keywords: ['projects', 'close', 'dismiss'],
      availability: (context) =>
        context.interaction.get().projectsSection === undefined
          ? unavailable('The Projects dialogue is not open.')
          : AVAILABLE,
    },
  );
}

/** The Projects dialogue, opened at a section and shut. */
function dialogueCommands(): readonly Command<ShellContext>[] {
  return [projectsCommand(), closeProjectsCommand()];
}

function createProjectCommand(): Command<ShellContext> {
  return shellCommand(
    'file.create-project',
    'Make a new project',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const named = givenName('project', textArgument(invocation, 'name'));
      if (!named.ok) return named.failures[0].summary;
      const name = named.value;
      const settings = settingsFrom(invocation);
      if (!settings.ok) return settings.failures[0].summary;
      sayWhenSettled(
        context,
        madeAndOpened(context, stores, name, settings.value),
        (header) => `${quoted(header.name)} is made and open.`,
      );
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

function openCommand(): Command<ShellContext> {
  return shellCommand(
    'file.open',
    'Open a project',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const named = idArgument<'ProjectId'>(invocation, 'project', 'project');
      if ('refused' in named) return named.refused;
      const project = named.id;
      const access = textArgument(invocation, 'access') === 'read' ? 'read' : 'write';
      const name = projectNameOf(stores, project);
      const work = stores.project.open(project, { access });
      context.interaction.setProjectsSection(undefined);
      sayWhenSettled(context, work, (kind) =>
        kind === 'writable' ? `${name} is open.` : `${name} is open to read.`,
      );
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

function closeProjectCommand(): Command<ShellContext> {
  return shellCommand(
    'file.close-project',
    'Close project',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, stores.project.close(), () => 'The project is closed.');
      return undefined;
    },
    {
      keywords: ['project', 'close', 'file'],
      availability: (context) => {
        const open = context.projects?.project.get();
        return open === undefined || open.kind === 'none'
          ? unavailable('No project is open.')
          : projectsAvailability(context);
      },
    },
  );
}

/** Making, opening and closing a project. */
function openingCommands(): readonly Command<ShellContext>[] {
  return [createProjectCommand(), openCommand(), closeProjectCommand()];
}

function renameProjectCommand(): Command<ShellContext> {
  return shellCommand(
    'file.rename-project',
    'Rename project',
    CommandCategory.File,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const named = givenName('project', textArgument(invocation, 'name'));
      if (!named.ok) return named.failures[0].summary;
      const name = named.value;
      const work = session.run({ commandId: ProjectCommandId.Rename, arguments: { name } });
      sayWhenSettled(context, work, (outcome) =>
        outcome.kind === 'applied' ? `The project is now called ${quoted(name)}.` : outcome.reason,
      );
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function forkProjectCommand(): Command<ShellContext> {
  return shellCommand(
    'file.fork-project',
    'Fork the project',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const open = stores.project.get();
      if (open.kind !== 'open') return 'No project is open.';
      const name = givenName('project', textArgument(invocation, 'name'));
      if (!name.ok) return name.failures[0].summary;
      const { history } = open.snapshot.model;
      const at =
        textArgument(invocation, 'node') === undefined
          ? { id: history.cursor }
          : idArgument<'HistoryNodeId'>(invocation, 'node', 'point of the history');
      if ('refused' in at) return at.refused;
      const work = stores.library.fork({
        source: open.snapshot.project,
        from: { kind: 'node', node: at.id },
        name: name.value,
      });
      sayWhenSettled(
        context,
        work,
        (header) => `${quoted(header.name)} is made. Open it from the Projects dialogue.`,
      );
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

/** Renaming the open project, and forking it. */
function namingCommands(): readonly Command<ShellContext>[] {
  return [renameProjectCommand(), forkProjectCommand()];
}

/** Every command a person runs on their projects as a whole. */
export function projectFileCommands(): readonly Command<ShellContext>[] {
  return [...dialogueCommands(), ...openingCommands(), ...namingCommands()];
}
