/**
 * Managing the model packs kept here (REQ-AUDIO-139, ADR-0062): looking at the
 * catalogue the build configures, installing a version it offers, pausing,
 * resuming, cancelling and retrying a download, importing a pack from a folder
 * the person has, and removing a version, knowingly where a project needs it.
 *
 * Each is a step of the storage worker's installer, the one authority on a
 * version's state (`ml/pack-manager.ts`), and none is undone with a project,
 * since a pack is the browser's, not a project's. A version is named by `id`
 * and `version`; where neither is given, the one version in a state the step
 * takes is meant, so "pause" from the palette pauses the one download there
 * is. A download and an import say what they came to once they settle, which
 * is also what a pause or a cancel of them comes to, so those say nothing of
 * their own. The catalogue is fetched only by the command that asks for it.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { DomainResult } from '@audiogubbins/domain';
import type { InstallState, Installation, PackRef } from '@audiogubbins/model-packs';
import { counted } from '@audiogubbins/text';

import { packTitle, settledWords } from '../ml/pack-words.js';
import { NOT_OFFERED, type PackManager } from '../ml/pack-manager.js';
import { sayWhenSettled } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Available where this browser keeps packs. */
function packsAvailability(context: ShellContext): CommandAvailability {
  const reason = context.packs.unavailable;
  return reason === undefined ? AVAILABLE : unavailable(reason);
}

/** A version as a person knows it, by its manifest where one is known, or by its identity. */
function titleOf(manager: PackManager, ref: PackRef): string {
  const manifest = manager.manifestOf(ref);
  return manifest === undefined
    ? `${ref.id} ${ref.version}`
    : packTitle(manifest.name, ref.version);
}

/** Which versions a step takes, and what is said where none, or several, are in that state. */
interface Takes {
  readonly states: ReadonlySet<InstallState['kind']>;
  readonly none: string;
}

/**
 * The version an invocation names by `id` and `version`, or the one version
 * the installer holds in a state `takes` names, or why there is none.
 */
function packArgument(
  manager: PackManager,
  invocation: CommandInvocation,
  takes: Takes,
): PackRef | string {
  const id = textArgument(invocation, 'id');
  const version = textArgument(invocation, 'version');
  if (id !== undefined || version !== undefined) {
    return id === undefined || version === undefined
      ? 'Name the pack by its identifier and its version.'
      : { id, version };
  }
  const taking = manager
    .get()
    .installations.filter((one: Installation) => takes.states.has(one.state.kind));
  const [only] = taking;
  if (only === undefined) return takes.none;
  return taking.length === 1
    ? only.ref
    : 'Several packs could be meant. Choose one in the Model packs panel.';
}

/** Says what a download, resume, retry or import of `ref` came to once it settles. */
function sayInstalled(
  context: ShellContext,
  ref: PackRef,
  work: Promise<DomainResult<InstallState>>,
): void {
  sayWhenSettled(context, work, (state) => settledWords(titleOf(context.packs, ref), state));
}

function refreshCommand(): Command<ShellContext> {
  return shellCommand(
    'packs.refresh-catalogue',
    'Check the model pack catalogue',
    CommandCategory.Settings,
    (context) => {
      sayWhenSettled(context, context.packs.refreshCatalogue(), (offered) =>
        offered === undefined
          ? undefined
          : offered.length === 0
            ? 'The catalogue offers no model packs.'
            : `The catalogue offers ${counted(offered.length, 'model pack version', 'model pack versions')}.`,
      );
    },
    {
      availability: packsAvailability,
      keywords: ['model', 'pack', 'catalogue', 'download', 'update', 'machine learning', 'refresh'],
      description:
        'Asks the catalogue this build uses which model packs it offers now. Nothing is downloaded until you install one.',
    },
  );
}

/** What a download asks of the person with nothing named. */
const CHOOSE_TO_INSTALL = 'Choose a pack to install in the Model packs panel.';

function installCommand(): Command<ShellContext> {
  return shellCommand(
    'packs.install',
    'Install a model pack',
    CommandCategory.Settings,
    (context, invocation) => {
      const ref = packArgument(context.packs, invocation, {
        states: new Set(),
        none: CHOOSE_TO_INSTALL,
      });
      if (typeof ref === 'string') return ref;
      if (context.packs.offered(ref) === undefined) return NOT_OFFERED;
      context.interaction.announce(`Downloading ${titleOf(context.packs, ref)}.`);
      sayInstalled(context, ref, context.packs.install(ref));
      return undefined;
    },
    {
      availability: packsAvailability,
      keywords: ['model', 'pack', 'install', 'download', 'update', 'machine learning'],
      description:
        'Downloads a version the catalogue offers and checks every file against its SHA-256 before anything uses it.',
    },
  );
}

/** A step on a download in flight or waiting: pausing or resuming, cancelling or retrying. */
function downloadStep(
  id: string,
  label: string,
  takes: Takes,
  keywords: readonly string[],
  description: string,
  step: (context: ShellContext, ref: PackRef) => void,
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Settings,
    (context, invocation) => {
      const ref = packArgument(context.packs, invocation, takes);
      if (typeof ref === 'string') return ref;
      step(context, ref);
      return undefined;
    },
    { availability: packsAvailability, keywords, description },
  );
}

function pauseCommand(): Command<ShellContext> {
  return downloadStep(
    'packs.pause',
    'Pause a model pack download',
    {
      states: new Set(['downloading', 'queued', 'verifying']),
      none: 'No model pack is downloading or being checked.',
    },
    ['model', 'pack', 'pause', 'download', 'stop'],
    'Stops a download or its check where it is, keeping what has arrived, so it can be resumed.',
    (context, ref) => {
      // What the pause comes to is what the download it stops says.
      sayWhenSettled(context, context.packs.pause(ref), () => undefined);
    },
  );
}

function resumeCommand(): Command<ShellContext> {
  return downloadStep(
    'packs.resume',
    'Resume a model pack download',
    { states: new Set(['paused']), none: 'No model pack download is paused.' },
    ['model', 'pack', 'resume', 'continue', 'download'],
    'Downloads the rest of a paused pack, from where it stopped.',
    (context, ref) => {
      context.interaction.announce(`Resuming ${titleOf(context.packs, ref)}.`);
      sayInstalled(context, ref, context.packs.resume(ref));
    },
  );
}

function retryCommand(): Command<ShellContext> {
  return downloadStep(
    'packs.retry',
    'Retry a model pack download',
    { states: new Set(['failed']), none: 'No model pack download has failed.' },
    ['model', 'pack', 'retry', 'again', 'download'],
    'Tries a failed download again: from what is kept where it can be continued, from the start where it cannot.',
    (context, ref) => {
      context.interaction.announce(`Trying ${titleOf(context.packs, ref)} again.`);
      sayInstalled(context, ref, context.packs.retry(ref));
    },
  );
}

function cancelCommand(): Command<ShellContext> {
  return downloadStep(
    'packs.cancel',
    'Cancel a model pack download',
    {
      states: new Set(['downloading', 'queued', 'paused', 'verifying']),
      none: 'No model pack download is under way, paused or being checked.',
    },
    ['model', 'pack', 'cancel', 'download', 'abandon'],
    'Gives up a download, waiting, paused, being checked or failed, and deletes what was kept of it.',
    (context, ref) => {
      // A download in flight says it was cancelled as it stops; one that was
      // not in flight is said here.
      sayWhenSettled(context, context.packs.cancel(ref), (state) =>
        state.kind === 'available' ? settledWords(titleOf(context.packs, ref), state) : undefined,
      );
    },
  );
}

function removeCommand(): Command<ShellContext> {
  return shellCommand(
    'packs.remove',
    'Remove a model pack',
    CommandCategory.Settings,
    (context, invocation) => {
      const ref = packArgument(context.packs, invocation, {
        states: new Set(),
        none: 'Choose a pack to remove in the Model packs panel.',
      });
      if (typeof ref === 'string') return ref;
      const knowingly = invocation.arguments?.['knowingly'] === true;
      const title = titleOf(context.packs, ref);
      sayWhenSettled(
        context,
        context.packs.remove(ref, knowingly),
        () =>
          `Removed ${title}. The processors that need it cannot run until it is installed again.`,
      );
      return undefined;
    },
    {
      availability: packsAvailability,
      keywords: ['model', 'pack', 'remove', 'delete', 'uninstall', 'free', 'space'],
      description:
        'Removes an installed or failed version. A version a project needs is kept unless you remove it knowingly.',
    },
  );
}

function importCommand(): Command<ShellContext> {
  return shellCommand(
    'packs.import',
    'Import a model pack from a folder',
    CommandCategory.Settings,
    (context) => {
      sayWhenSettled(context, context.packs.importFolder(), (imported) =>
        imported === undefined
          ? undefined
          : settledWords(
              packTitle(imported.manifest.name, imported.manifest.version),
              imported.state,
            ),
      );
    },
    {
      availability: packsAvailability,
      keywords: ['model', 'pack', 'import', 'folder', 'offline', 'install', 'file'],
      description:
        'Installs a pack from its folder, the one holding its manifest.json and the files it names, checking every file against its SHA-256. Nothing is downloaded.',
    },
  );
}

/** The commands that manage the model packs. */
export function packCommands(): readonly Command<ShellContext>[] {
  return [
    refreshCommand(),
    installCommand(),
    pauseCommand(),
    resumeCommand(),
    cancelCommand(),
    retryCommand(),
    removeCommand(),
    importCommand(),
  ];
}
