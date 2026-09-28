/**
 * The name a workspace carries.
 *
 * The one rule for it, in the form a layout is saved, copied or renamed under
 * and in the form a stored one is read in; what a workspace is called when
 * nobody chose its name; and how a list of workspaces names one. Apart from
 * the store, which holds every layout it writes and reads to the rule and
 * every name it gives to the names in use, because the name is a concept of
 * its own.
 */

import {
  asName,
  asWrittenName,
  firstFreeCopyName,
  firstFreeName,
  type NameProblem,
} from '@audiogubbins/text';

import type { WorkspaceLayout } from './panel.js';

/**
 * The longest name a workspace may carry, in the characters a reader sees.
 *
 * The name is drawn in the menus and the settings and said whole in "Switched
 * to …", so a name with no bound is a sentence of any length in a live region.
 * Long enough for any name a person writes, and counted as the text package
 * counts, so a character built of more marks than any real one counts for each
 * allowance it fills and the name stays a few thousand code units at most.
 * Offered, so the settings can say it before a name is typed.
 */
export const LONGEST_WORKSPACE_NAME = 120;

/**
 * Why a name cannot be given to a workspace: which part of the rule refused
 * it, and what to say to the reader who typed it.
 */
export interface WorkspaceNameProblem extends NameProblem {
  /**
   * British-English explanation, written for a name being given, or for the
   * name a stored layout carries.
   */
  readonly text: string;
}

/** How a name being given is refused, by the part of the rule that refused it. */
const GIVEN_NAME_REFUSED: Readonly<Record<NameProblem['kind'], string>> = {
  blank: 'A workspace needs a name.',
  'too-long': `A workspace's name can be at most ${String(LONGEST_WORKSPACE_NAME)} characters long.`,
};

/** How a stored layout's name is refused, by the part of the rule that refused it. */
const STORED_NAME_REFUSED: Readonly<Record<NameProblem['kind'], string>> = {
  blank: 'The stored layout has no name.',
  'too-long': `The stored layout's name is longer than ${String(LONGEST_WORKSPACE_NAME)} characters.`,
};

/** A name the rule takes, or the part of the rule that refused it, in the words given. */
function worded(
  name: string | NameProblem,
  refusals: Readonly<Record<NameProblem['kind'], string>>,
): string | WorkspaceNameProblem {
  return typeof name === 'string' ? name : { kind: name.kind, text: refusals[name.kind] };
}

/**
 * `displayName` as a name given to a workspace, without the space around it,
 * or why it cannot be one: the rule where a layout is saved, copied or
 * renamed.
 */
export function workspaceName(displayName: string): string | WorkspaceNameProblem {
  return worded(asName(displayName, LONGEST_WORKSPACE_NAME), GIVEN_NAME_REFUSED);
}

/**
 * `value` as the name a stored layout carries, as it is written, or why it
 * cannot be one; a value that is not text is refused as a blank name.
 *
 * The rule a name given is held to, since a stored name is drawn and said as a
 * typed one is: both forms ask the text package's one rule, within the one
 * bound, so the store cannot write a name its own next read refuses. Kept as
 * it is written, since the reader of a stored layout keeps what is stored, and
 * refused rather than cut, as every other rule of the reading refuses: what
 * the reader of a refused layout keeps of it is the reader's to say.
 */
export function writtenWorkspaceName(value: unknown): string | WorkspaceNameProblem {
  return worded(asWrittenName(value, LONGEST_WORKSPACE_NAME), STORED_NAME_REFUSED);
}

/**
 * Why no workspace is given a name where this runtime cannot compare two names
 * by the one rule (see `namesCanBeCompared`): whether another workspace has a
 * name cannot be decided, and a name given without it could be one the list
 * already shows.
 */
export const NAMING_REFUSED =
  'This browser cannot compare names as AudioGubbins does, so a workspace cannot be saved as a new one, copied or renamed here.';

/** What the name of a copy of a workspace adds to the name of what it copies. */
const A_COPY = 'copy';

/**
 * What a copy of a workspace is called when nobody chose its name: the first
 * of "<name> copy", "<name> copy 2", "<name> copy 3" and on that no workspace
 * has, within the bound, so the menus, the settings and "Switched to …" tell
 * each copy apart. A copy of a copy is numbered in the series of the name it
 * is a copy of: a copy of "Editing copy", or of "Editing Copy", is "Editing
 * copy 2".
 */
export function nameOfACopy(displayName: string, taken: (name: string) => boolean): string {
  return firstFreeCopyName(displayName, A_COPY, LONGEST_WORKSPACE_NAME, taken);
}

/**
 * What a workspace saved from the one on screen is called when nobody chose
 * its name: the first of "My workspace", "My workspace 2" and on that no
 * workspace has.
 */
export function nameOfANewWorkspace(taken: (name: string) => boolean): string {
  return firstFreeName('My workspace', LONGEST_WORKSPACE_NAME, taken);
}

/**
 * What a workspace that reaches the list under `displayName`, a name nobody
 * held to the list as it is now, is called beside the others: `displayName`
 * where `taken` does not refuse it, and otherwise the first of "<name> 2",
 * "<name> 3" and on that it does not, the name without the space around it,
 * within the bound, as a shortcut profile carried in from a file is numbered.
 */
export function nameBesideTheOthers(displayName: string, taken: (name: string) => boolean): string {
  return taken(displayName)
    ? firstFreeName(displayName, LONGEST_WORKSPACE_NAME, taken)
    : displayName;
}

/**
 * A workspace's name as a list of workspaces shows it: a built-in one marked,
 * so the Workspace menu and the settings say alike which ones ship, and which
 * can be reset but not renamed or deleted.
 */
export function listedName(layout: WorkspaceLayout): string {
  return layout.builtIn ? `${layout.displayName} (built in)` : layout.displayName;
}
