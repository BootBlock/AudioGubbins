/**
 * What every project command shares: whether projects can be reached now, and
 * why not, and how an operation that finishes later says what it came to.
 *
 * A shell command runs at once and a project operation settles later, since
 * storage is written as it goes. So a command checks what it can before it
 * starts, returns, and has the operation's outcome said when it settles: its
 * success politely, its refusal urgently with every reason, as `executeVoiced`
 * says a command's own refusal. An operation that rejects is a fault rather
 * than a refusal, and is logged and said as one, never dropped.
 */

import {
  AVAILABLE,
  unavailable,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  isWellFormedId,
  unsafeBrandId,
  type Branded,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import type { ProjectSession } from '@audiogubbins/storage';
import { cutAtAWord } from '@audiogubbins/text';

import type { ProjectStores } from '../state/project-stores.js';
import type { StorageRootState } from '../state/storage-root-store.js';
import { quoted } from '../wording.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The longest a reason is said at, as a command's own refusal is. */
const LONGEST_REASON = 200;

/** The name a project goes by, from the list, or a phrase where the list has none. */
export function projectNameOf(stores: ProjectStores, project: ProjectId): string {
  const header = stores.library.headerOf(project);
  return header === undefined ? 'The project' : quoted(header.name);
}

/** Why nothing can be done with projects while the storage root stands so. */
function rootProblem(root: StorageRootState): string | undefined {
  switch (root.kind) {
    case 'ready':
      return undefined;
    case 'unavailable':
      return root.reason;
    case 'opening':
      return 'Your projects are still being opened.';
    case 'failed':
      return `Your projects could not be read. ${root.cause.summary}`;
    case 'blocked':
      return 'Your stored projects were made by another version of AudioGubbins, so none can be opened until you decide what to do with them.';
  }
}

/**
 * The identifier an argument holds, or why it holds none. An identifier is
 * text, so it is answered inside an object, apart from the refusal's text.
 */
export function idArgument<TBrand extends string>(
  invocation: CommandInvocation,
  name: string,
  what: string,
): { readonly id: Branded<TBrand> } | { readonly refused: string } {
  const text = textArgument(invocation, name);
  if (text === undefined) return { refused: `Say which ${what}.` };
  return isWellFormedId(text)
    ? { id: unsafeBrandId<TBrand>(text) }
    : { refused: `There is no such ${what}.` };
}

/** The project stores, where projects can be reached now, or why they cannot. */
export function readyProjects(context: ShellContext): ProjectStores | string {
  const problem = rootProblem(context.storageRoot.get());
  if (problem !== undefined) return problem;
  return context.projects ?? 'This browser cannot keep projects.';
}

/** Available where projects can be reached now. */
export function projectsAvailability(context: ShellContext): CommandAvailability {
  const stores = readyProjects(context);
  return typeof stores === 'string' ? unavailable(stores) : AVAILABLE;
}

/** Why no project is open to change here, or `undefined` where one is. */
function sessionProblem(context: ShellContext): string | undefined {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  if (stores.project.session() !== undefined) return undefined;
  const open = stores.project.get();
  return open.kind === 'open'
    ? 'This tab can only read the project open here, so it cannot change it.'
    : 'No project is open.';
}

/** The session of the project open to change, or why there is none. */
export function sessionOf(context: ShellContext): ProjectSession | string {
  const problem = sessionProblem(context);
  const session = context.projects?.project.session();
  return problem ?? session ?? 'No project is open.';
}

/** Available where a project is open to change here. */
export function sessionAvailability(context: ShellContext): CommandAvailability {
  const problem = sessionProblem(context);
  return problem === undefined ? AVAILABLE : unavailable(problem);
}

/**
 * Says what an operation came to once it settles: `said` of its value,
 * politely, where it says anything, and every reason it refused, urgently.
 */
export function sayWhenSettled<TValue>(
  context: ShellContext,
  work: Promise<DomainResult<TValue>>,
  said: (value: TValue) => string | undefined,
): void {
  const { announce } = context.interaction;
  work.then(
    (result) => {
      if (!result.ok) {
        const reasons = result.failures.map((one) => cutAtAWord(one.summary, LONGEST_REASON));
        announce(reasons.join(' '), true, { refusal: true });
        return;
      }
      const text = said(result.value);
      if (text !== undefined) announce(text);
    },
    (error: unknown) => {
      const reason = error instanceof Error ? error.message : 'No reason was given.';
      context.diagnostics.loggerFor('projects').error('A project operation failed.', { reason });
      announce(`Something went wrong, so that did not finish. ${reason}`, true, {
        refusal: true,
      });
    },
  );
}
