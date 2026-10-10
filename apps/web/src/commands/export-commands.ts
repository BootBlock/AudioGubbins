/**
 * The export's own commands (ADR-0092, REQ-EDIT-073, REQ-UX-005): cancelling
 * it, answering a taken name, delivering a held file again or elsewhere, and
 * keeping folders trusted. Starting an export is the Export dialog's.
 *
 * Every chooser opens first in the body, in the person's gesture, since a
 * browser opens none outside one, and leave to write is asked there too; the
 * work it starts says what it came to when it settles.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { fail, failure, FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  safeFileName,
  type CollisionAnswer,
  type CollisionPolicy,
} from '@audiogubbins/import-export';

import type { ExportControl, ExportDestinationChoice } from '../export/export-types.js';
import type { ProjectStores } from '../state/project-stores.js';
import { ExportCommand } from './import-export-ids.js';
import { readyProjects, sayWhenSettled, sessionOf } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The answers a collision takes, by the words an invocation names them with. */
const ANSWERS: ReadonlySet<string> = new Set<CollisionAnswer>(['overwrite', 'rename', 'skip']);

/** The policies a folder chosen anew may take, by the same words. */
const POLICIES: ReadonlySet<string> = new Set<CollisionPolicy>([
  'prompt',
  'overwrite',
  'skip',
  'rename',
]);

function isAnswer(text: string): text is CollisionAnswer {
  return ANSWERS.has(text);
}

function isPolicy(text: string): text is CollisionPolicy {
  return POLICIES.has(text);
}

/** Why nothing is held, said wherever only a held export can be acted on. */
const NOTHING_HELD = 'No export is waiting on a file it could not deliver.';

/** Available where the export is in one of `kinds`, else for `reason`. */
function availableFor(
  kinds: readonly ('running' | 'held')[],
  reason: string,
): (context: ShellContext) => CommandAvailability {
  return (context) => {
    const kind = context.exports?.get().kind;
    return kinds.some((one) => one === kind) ? AVAILABLE : unavailable(reason);
  };
}

function cancelCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.Cancel,
    'Cancel the export',
    CommandCategory.File,
    (context) => {
      const { exports } = context;
      const held = exports?.get().kind === 'held';
      if (exports?.cancel() !== true) return 'No export is running.';
      // A running export says what it came to as its start settles; a held one
      // has nothing waiting on it, so it is said here.
      if (held) {
        context.interaction.announce(
          'The export is cancelled, and the files it kept are given up.',
        );
      }
      return undefined;
    },
    {
      keywords: ['cancel', 'stop', 'export'],
      availability: availableFor(['running', 'held'], 'No export is running.'),
    },
  );
}

function answerCollisionCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.AnswerCollision,
    'Answer the question about a taken name',
    CommandCategory.File,
    (context, invocation) => {
      const text = textArgument(invocation, 'answer');
      if (text !== undefined && !isAnswer(text)) {
        return 'Say whether to replace the file, keep both or skip it.';
      }
      const applyToAll = invocation.arguments?.['applyToAll'] === true;
      const reply = text === undefined ? undefined : { answer: text, applyToAll };
      return context.exports?.answerCollision(reply) === true
        ? undefined
        : 'No question about a taken name is waiting.';
    },
    {
      keywords: ['replace', 'keep both', 'skip', 'collision', 'overwrite', 'export'],
      discoverable: false,
      availability: (context) => {
        const state = context.exports?.get();
        return state?.kind === 'running' && state.asking !== undefined
          ? AVAILABLE
          : unavailable('No question about a taken name is waiting.');
      },
    },
  );
}

/** The held job an invocation names, with the export holding it and its file's name, or why it names none. */
function heldJob(
  context: ShellContext,
  invocation: CommandInvocation,
): string | { readonly exports: ExportControl; readonly job: string; readonly name: string } {
  const job = textArgument(invocation, 'job');
  if (job === undefined) return 'Say which file to deliver.';
  const { exports } = context;
  const state = exports?.get();
  if (exports === undefined || state?.kind !== 'held') return NOTHING_HELD;
  const file = state.files.get(job);
  return file === undefined
    ? 'That file is not part of the export.'
    : { exports, job, name: safeFileName(file.name) };
}

function retryCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.Retry,
    'Retry the delivery',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const named = heldJob(context, invocation);
      if (typeof named === 'string') return named;
      sayWhenSettled(context, named.exports.retry(session, named.job), (said) => said);
      return undefined;
    },
    {
      keywords: ['retry', 'again', 'deliver', 'export'],
      discoverable: false,
      availability: availableFor(['held'], NOTHING_HELD),
    },
  );
}

/** Where a held file goes instead, chosen by the person as an invocation asks. */
async function chosenElsewhere(
  stores: ProjectStores,
  invocation: CommandInvocation,
  name: string,
): Promise<DomainResult<ExportDestinationChoice | undefined>> {
  const to = textArgument(invocation, 'to') ?? 'file';
  switch (to) {
    case 'file':
      return succeed(await stores.exportDestinations.chooseFile(name));
    case 'download':
      return succeed({ kind: 'download' });
    case 'folder': {
      const policy = textArgument(invocation, 'policy') ?? 'prompt';
      if (!isPolicy(policy)) {
        return fail(
          failure(
            'export.policy-unknown',
            FailureKind.Rejected,
            'Say whether to ask, replace, keep both or skip where a name is taken.',
          ),
        );
      }
      return await stores.exportDestinations.chooseFolder(policy);
    }
    default:
      return fail(
        failure(
          'export.destination-unknown',
          FailureKind.Rejected,
          'Say whether to save it as a file, into a folder, or as a download.',
        ),
      );
  }
}

function deliverElsewhereCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.DeliverElsewhere,
    'Deliver the export elsewhere…',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const named = heldJob(context, invocation);
      if (typeof named === 'string') return named;
      const work = chosenElsewhere(stores, invocation, named.name).then(
        async (chosen): Promise<DomainResult<string | undefined>> => {
          if (!chosen.ok) return chosen;
          if (chosen.value === undefined) return succeed(undefined);
          return await named.exports.deliverElsewhere(session, named.job, chosen.value);
        },
      );
      sayWhenSettled(context, work, (said) => said);
      return undefined;
    },
    {
      keywords: ['deliver', 'elsewhere', 'save as', 'folder', 'another', 'export'],
      discoverable: false,
      availability: availableFor(['held'], NOTHING_HELD),
    },
  );
}

/** Why folders cannot be kept trusted here, or `undefined` where they can. */
function trustProblem(context: ShellContext): string | undefined {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  const state = stores.trustedFolders.get();
  return state.kind === 'unavailable' ? state.reason : undefined;
}

function trustFolderCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.TrustFolder,
    'Trust a folder for exports…',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const problem = trustProblem(context);
      if (problem !== undefined) return problem;
      const work = stores.exportDestinations
        .chooseFolderToTrust()
        .then(async (chosen): Promise<DomainResult<string | undefined>> => {
          if (!chosen.ok) return chosen;
          if (chosen.value === undefined) return succeed(undefined);
          return await stores.trustedFolders.trust(chosen.value);
        });
      sayWhenSettled(context, work, (said) => said);
      return undefined;
    },
    {
      keywords: ['trust', 'folder', 'export', 'overwrite', 'game'],
      availability: (context) => {
        const problem = trustProblem(context);
        return problem === undefined ? AVAILABLE : unavailable(problem);
      },
    },
  );
}

function forgetFolderCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.ForgetFolder,
    'Stop trusting a folder',
    CommandCategory.File,
    (context, invocation) => {
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const key = textArgument(invocation, 'key');
      if (key === undefined) return 'Say which folder to stop trusting.';
      sayWhenSettled(context, stores.trustedFolders.forget(key), (said) => said);
      return undefined;
    },
    {
      keywords: ['forget', 'untrust', 'folder', 'export'],
      discoverable: false,
      availability: (context) => {
        const problem = trustProblem(context);
        return problem === undefined ? AVAILABLE : unavailable(problem);
      },
    },
  );
}

/** The export's own commands. */
export function exportCommands(): readonly Command<ShellContext>[] {
  return [
    cancelCommand(),
    answerCollisionCommand(),
    retryCommand(),
    deliverElsewhereCommand(),
    trustFolderCommand(),
    forgetFolderCommand(),
  ];
}
