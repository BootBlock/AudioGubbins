/**
 * The open project's backups: making a protected one now, the policy that makes
 * them on their own, keeping one from pruning, and restoring one as a new
 * project or in place of the project (REQ-STOR-105, REQ-STOR-198).
 *
 * Restoring in place is no change the history can undo, so the project as it
 * was is kept first as a protected backup of its own, and the person is told
 * which. The policy's numbers arrive as the settings typed them, and are
 * checked here before a policy the project could not read back is kept.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import type { BackupPolicy, BackupRetention, BackupTrigger } from '@audiogubbins/project-format';

import { quoted } from '../wording.js';
import {
  projectsAvailability,
  readyProjects,
  sayWhenSettled,
  sessionAvailability,
} from './project-access.js';
import { recordedNote } from './project-transfer-commands.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** How a time is written in what is said about a backup. */
const WHEN = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** A whole positive number an argument holds, `undefined` where it holds none, or why it is not one. */
function countArgument(invocation: CommandInvocation, name: string): number | undefined | string {
  const value = invocation.arguments?.[name];
  if (value === undefined || value === null || value === 0) return undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 'Each number of a backup policy is a whole number above nought.';
}

/** The backup policy the arguments describe, or why they describe none. */
function backupPolicyFrom(invocation: CommandInvocation): BackupPolicy | string {
  if (textArgument(invocation, 'kind') === 'off') return { kind: 'off' };
  const counts = ['everyMinutes', 'everyChanges', 'keepCount', 'keepDays', 'keepBytes'].map(
    (name) => countArgument(invocation, name),
  );
  const refused = counts.find((count) => typeof count === 'string');
  if (refused !== undefined) return refused;
  const [minutes, changes, count, days, bytes] = counts.map((one) =>
    typeof one === 'number' ? one : undefined,
  );
  if (minutes === undefined && changes === undefined) {
    return 'Say how often a backup is made: after some minutes of work, or after some changes.';
  }
  const trigger: BackupTrigger = {
    ...(minutes === undefined ? {} : { everyMinutes: minutes }),
    ...(changes === undefined ? {} : { everyChanges: changes }),
  };
  const retention: BackupRetention = {
    ...(count === undefined ? {} : { count }),
    ...(days === undefined ? {} : { days }),
    ...(bytes === undefined ? {} : { bytes }),
  };
  // Asked for by name, so a policy set without it copies nothing out.
  const external = invocation.arguments?.['external'] === true;
  return { kind: 'automatic', trigger, retention, ...(external ? { external } : {}) };
}

function backUpNowCommand(): Command<ShellContext> {
  return shellCommand(
    'file.back-up-now',
    'Back up now',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, stores.backups.backUpNow(), (tick) =>
        tick.kind === 'busy'
          ? 'A backup is being made already.'
          : 'A backup is made, and kept until you remove it.',
      );
      return undefined;
    },
    {
      keywords: ['backup', 'back up', 'save', 'copy', 'protect'],
      availability: sessionAvailability,
    },
  );
}

function setPolicyCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.set-policy',
    'Set how backups are made',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const policy = backupPolicyFrom(invocation);
      if (typeof policy === 'string') return policy;
      sayWhenSettled(context, stores.backups.setPolicy(policy), () =>
        policy.kind === 'off'
          ? 'Backups are no longer made on their own.'
          : 'Backups are made on their own as you set.',
      );
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function protectCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.protect',
    'Keep a backup',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const generation = invocation.arguments?.['generation'];
      if (typeof generation !== 'number') return 'Say which backup.';
      const keep = invocation.arguments?.['keep'] !== false;
      sayWhenSettled(context, stores.backups.protect(generation, keep), () =>
        keep
          ? 'The backup is kept until you remove it.'
          : 'The backup goes when the policy no longer keeps it.',
      );
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function deleteCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.delete',
    'Delete a backup',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const generation = invocation.arguments?.['generation'];
      if (typeof generation !== 'number') return 'Say which backup.';
      sayWhenSettled(context, stores.backups.remove(generation), () => 'The backup is deleted.');
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function restoreCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.restore',
    'Restore a backup',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const generation = invocation.arguments?.['generation'];
      if (typeof generation !== 'number') return 'Say which backup.';
      const target =
        textArgument(invocation, 'as') === 'replace-current' ? 'replace-current' : 'new-project';
      sayWhenSettled(context, stores.backups.restore(generation, target), (restored) =>
        restored.kind === 'new-project'
          ? `${quoted(restored.header.name)} is restored as a new project.`
          : `The project is back as the backup kept it. How it was just before is kept as the backup of ${WHEN.format(restored.previous.at)}.`,
      );
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function exportBackupCommand(): Command<ShellContext> {
  return shellCommand(
    'backup.export',
    'Export a backup',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const open = stores.project.get();
      if (open.kind !== 'open') return 'No project is open.';
      const generation = invocation.arguments?.['generation'];
      if (typeof generation !== 'number') return 'Say which backup.';
      const name = open.snapshot.model.state.project.displayName;
      const backup = stores.backups.get().generations.find((one) => one.number === generation);
      if (backup === undefined) return 'That backup is not kept.';
      const titled = `${name}, backed up ${WHEN.format(backup.at).replaceAll(':', '.')}`;
      sayWhenSettled(
        context,
        stores.transfer.exportBackup(open.snapshot.project, generation, titled),
        (exported) =>
          exported === undefined
            ? undefined
            : `The backup is exported as a bundle.${recordedNote(exported.recorded)}`,
      );
      return undefined;
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

/** Every command on the open project's backups. */
export function backupCommands(): readonly Command<ShellContext>[] {
  return [
    exportBackupCommand(),
    backUpNowCommand(),
    setPolicyCommand(),
    protectCommand(),
    deleteCommand(),
    restoreCommand(),
  ];
}
