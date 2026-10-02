/**
 * The storage as a whole: the compatibility decisions for data of another
 * version, and measuring what the storage holds and cleaning it up
 * (REQ-STOR-052, REQ-STOR-102, REQ-STOR-106, REQ-STOR-200).
 *
 * Wiping and every cleanup step past the caches remove what cannot be made
 * again, so each runs only from the confirmation that says what goes: wiping
 * from the second of its two confirmations, and a cleanup with the bytes the
 * person was shown, which the storage checks against its plan.
 */

import { cleanedSentences } from '../cleanup-words.js';
import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  CACHE_CLEANUP_ORDER,
  type CleanupChoice,
  type CleanupSelection,
} from '@audiogubbins/storage';

import { projectsAvailability, readyProjects, sayWhenSettled } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Every kind of cleanup a person may choose besides a cache, by the name an argument gives it. */
const CHOICES: readonly CleanupChoice['kind'][] = [
  'unfinished-projects',
  'expired-backups',
  'expired-history',
  'set-aside-records',
  'unreferenced-media',
];

/**
 * The cleanup the arguments choose, or why a name is none. No `choices` at all
 * asks for every step; an empty list asks for none, which is what a person
 * leaving every step out of a plan has chosen.
 */
function selectionFrom(
  invocation: CommandInvocation,
): { readonly selection: CleanupSelection } | { readonly refused: string } {
  const named = invocation.arguments?.['choices'];
  if (named === undefined) return { selection: 'everything' };
  if (typeof named !== 'string') return { refused: 'The cleanup choices are not a list of names.' };
  const chosen: CleanupChoice[] = [];
  if (named === '') return { selection: chosen };
  for (const name of named.split(',')) {
    const category = CACHE_CLEANUP_ORDER.find((one) => `cache:${one}` === name);
    const kind = CHOICES.find((one) => one === name);
    if (category !== undefined) chosen.push({ kind: 'cache', category });
    else if (kind !== undefined && kind !== 'cache') chosen.push({ kind });
    else return { refused: `There is no cleanup called ${name}.` };
  }
  return { selection: chosen };
}

/** Available where the stored data blocks every project, and the screen is `shown` or not. */
function blocked(context: ShellContext, shown?: boolean): CommandAvailability {
  const root = context.storageRoot.get();
  if (root.kind !== 'blocked') return unavailable('The stored projects can be opened.');
  return shown === undefined || root.shown === shown
    ? AVAILABLE
    : unavailable(shown ? 'The stored data is set aside.' : 'The stored data is being decided on.');
}

function exportRawCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.export-raw',
    'Save a copy of the stored data',
    CommandCategory.File,
    (context) => {
      const files = context.projects?.files;
      if (files === undefined) return 'This browser cannot keep projects.';
      sayWhenSettled(context, context.storageRoot.exportRaw(files), (saved) =>
        saved ? 'A copy of the stored data is saved.' : undefined,
      );
      return undefined;
    },
    {
      keywords: ['export', 'stored', 'data', 'copy', 'backup'],
      availability: (context) => blocked(context),
    },
  );
}

function setAsideCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.set-aside',
    'Decide later about the stored data',
    CommandCategory.File,
    (context) => {
      context.storageRoot.setAside();
      context.interaction.announce(
        'The stored data is left as it is. Projects cannot be made or opened until you decide.',
      );
    },
    { discoverable: false, availability: (context) => blocked(context, true) },
  );
}

function reviewCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.review',
    'Decide about the stored data',
    CommandCategory.File,
    (context) => {
      context.storageRoot.review();
    },
    {
      keywords: ['stored', 'data', 'version', 'compatibility'],
      availability: (context) => blocked(context, false),
    },
  );
}

function wipeCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.wipe',
    'Remove the stored data',
    CommandCategory.File,
    (context, invocation) => {
      if (textArgument(invocation, 'confirmed') !== 'yes') {
        return 'Removing the stored data needs your confirmation, from the screen that explains it.';
      }
      const wiped = context.storageRoot.wipe().then(async (done) => {
        if (done.ok) await context.projects?.library.refresh();
        return done;
      });
      sayWhenSettled(
        context,
        wiped,
        () => 'The stored data is removed. You can make new projects now.',
      );
      return undefined;
    },
    { discoverable: false, availability: (context) => blocked(context) },
  );
}

/** The decisions about stored data of another version. */
function compatibilityCommands(): readonly Command<ShellContext>[] {
  return [exportRawCommand(), setAsideCommand(), reviewCommand(), wipeCommand()];
}

function measureCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.measure',
    'Measure storage',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      sayWhenSettled(context, stores.usage.measure(), () => undefined);
      return undefined;
    },
    {
      keywords: ['storage', 'usage', 'space', 'size', 'measure'],
      availability: projectsAvailability,
    },
  );
}

function planCleanupCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.plan-cleanup',
    'Plan a cleanup of storage',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const chosen = selectionFrom(invocation);
      if ('refused' in chosen) return chosen.refused;
      sayWhenSettled(context, stores.usage.plan(chosen.selection), (plan) =>
        plan.steps.length === 0
          ? 'There is nothing of that to clean up.'
          : 'The cleanup is planned. Review it before you carry it out.',
      );
      return undefined;
    },
    {
      keywords: ['storage', 'cleanup', 'clean', 'free', 'space', 'purge'],
      availability: projectsAvailability,
    },
  );
}

function cleanUpCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.clean-up',
    'Carry out the planned cleanup',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const bytes = invocation.arguments?.['bytes'];
      const work = stores.usage.clean(typeof bytes === 'number' ? bytes : undefined);
      sayWhenSettled(context, work, (outcomes) => cleanedSentences(outcomes).join(' '));
      return undefined;
    },
    {
      discoverable: false,
      availability: (context) =>
        context.projects?.usage.get().plan === undefined
          ? unavailable('No cleanup is planned.')
          : projectsAvailability(context),
    },
  );
}

function dismissCleanupCommand(): Command<ShellContext> {
  return shellCommand(
    'storage.dismiss-cleanup',
    'Put the cleanup away',
    CommandCategory.File,
    (context) => {
      context.projects?.usage.dismiss();
    },
    { discoverable: false, availability: projectsAvailability },
  );
}

/** Measuring the storage and cleaning it up. */
function cleanupCommands(): readonly Command<ShellContext>[] {
  return [measureCommand(), planCleanupCommand(), cleanUpCommand(), dismissCleanupCommand()];
}

/** Every command on the storage as a whole. */
export function storageCommands(): readonly Command<ShellContext>[] {
  return [...compatibilityCommands(), ...cleanupCommands()];
}
