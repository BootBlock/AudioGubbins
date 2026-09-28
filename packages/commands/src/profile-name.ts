/**
 * The name a shortcut profile carries.
 *
 * The one rule for it, where a profile is made and where one is read, so no
 * name is written that the next read refuses; how a typed name another profile
 * has is refused; what a copy is called when nobody chose its name; and what a
 * profile carried in is called where another has the name it carries. A
 * profile is copied and read in this package, and both hold a name to what is
 * written here.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import {
  asName,
  asWrittenName,
  firstFreeCopyName,
  firstFreeName,
  type NameProblem,
} from '@audiogubbins/text';

import type { ShortcutProfile } from './shortcut.js';

/**
 * The longest name a profile may carry.
 *
 * Long enough for any name a person writes, and short enough that a name from
 * a shared profile cannot become a sentence nobody can read or a live region
 * nobody can interrupt. Counted in the characters a reader sees, which is what
 * the refusal tells them, rather than in code units, in which a name of sixty
 * emoji is a hundred and twenty; and a character built of more marks than any
 * real one counts for each allowance it fills, so the name stays a few
 * thousand code units at most.
 */
export const LONGEST_PROFILE_NAME = 120;

/**
 * Why a name cannot be given to a profile: which part of the rule refused it,
 * and what to say to the reader who gave it.
 */
export interface ProfileNameProblem extends NameProblem {
  /** British-English explanation, written for a name being given. */
  readonly text: string;
}

/** How a name being given is refused, by the part of the rule that refused it. */
const GIVEN_NAME_REFUSED: Readonly<Record<NameProblem['kind'], string>> = {
  blank: 'A profile needs a name.',
  'too-long': `A profile's name can be at most ${String(LONGEST_PROFILE_NAME)} characters long.`,
};

/** A name the rule takes, or the part of the rule that refused it, worded. */
function worded(name: string | NameProblem): string | ProfileNameProblem {
  return typeof name === 'string' ? name : { kind: name.kind, text: GIVEN_NAME_REFUSED[name.kind] };
}

/**
 * `value` as a name given to a profile, without the space around it, or why it
 * cannot be one.
 */
export function profileName(value: unknown): string | ProfileNameProblem {
  return worded(asName(value, LONGEST_PROFILE_NAME));
}

/**
 * `value` as the name written in a profile's text, as it is written, or why it
 * cannot be one; a value that is not text is refused as a blank name.
 *
 * As written, because the text is read from storage as well as from a file,
 * and a stored name is read as it is stored; a name carried in a file is
 * trimmed where it is numbered beside the others (see `nameOfAnImport`).
 */
export function writtenProfileName(value: unknown): string | ProfileNameProblem {
  return worded(asWrittenName(value, LONGEST_PROFILE_NAME));
}

/** The code a refused name fails with, by the part of the rule that refused it. */
const FAILURE_CODES: Readonly<Record<NameProblem['kind'], string>> = {
  blank: 'shortcut-profile.has-no-name',
  'too-long': 'shortcut-profile.name-too-long',
};

/** A refused name as a failure, in the words `text` gives, or the rule's own. */
export function nameFailure(problem: ProfileNameProblem, text = problem.text): DomainFailure {
  return failure(FAILURE_CODES[problem.kind], FailureKind.Rejected, text);
}

/**
 * The failure for a name being given that `holder` has already.
 *
 * Refused rather than taken, because two profiles of one name are two entries
 * the settings list and "The … shortcuts are in force" cannot tell apart.
 */
export function nameInUse(holder: ShortcutProfile): DomainFailure {
  return failure(
    'shortcut-profile.name-in-use',
    FailureKind.Conflict,
    `There is already a profile called "${holder.displayName}". Choose another name.`,
  );
}

/**
 * The code of {@link namingRefused}'s failure, by which a caller tells the
 * refusal a runtime that cannot compare names meets from a fault in the rules.
 */
export const NAMES_CANNOT_BE_COMPARED = 'shortcut-profile.names-cannot-be-compared';

/**
 * The failure for a name given, copied or carried in where this runtime cannot
 * compare two names by the one rule (see `namesCanBeCompared`): whether
 * another profile has the name cannot be decided, and a profile named without
 * it could be one the settings already list.
 */
export function namingRefused(): DomainFailure {
  return failure(
    NAMES_CANNOT_BE_COMPARED,
    FailureKind.Unrecoverable,
    'This browser cannot compare names as AudioGubbins does, so a profile cannot be copied, imported or named here.',
  );
}

/** What the name of a copy of a profile adds to the name of what it copies. */
const A_COPY = 'copy';

/**
 * What a copy of `profile` is called when nobody chose its name: for a copy of
 * a profile AudioGubbins ships, the first of "My shortcuts", "My shortcuts 2"
 * and on that `taken` does not refuse, and for a copy of one the user made,
 * the first of "<name> copy", "<name> copy 2" and on, within the bound. A copy
 * of a copy is numbered in the series of the name it is a copy of: a copy of
 * "Mine copy", or of "Mine Copy", is "Mine copy 2".
 */
export function nameOfACopy(profile: ShortcutProfile, taken: (name: string) => boolean): string {
  return profile.builtIn
    ? firstFreeName('My shortcuts', LONGEST_PROFILE_NAME, taken)
    : firstFreeCopyName(profile.displayName, A_COPY, LONGEST_PROFILE_NAME, taken);
}

/**
 * What a profile carried in under `displayName` is called beside the others:
 * the first of "<name>", "<name> 2", "<name> 3" and on that `taken` does not
 * refuse, the name without the space around it, within the bound.
 */
export function nameOfAnImport(displayName: string, taken: (name: string) => boolean): string {
  return firstFreeName(displayName, LONGEST_PROFILE_NAME, taken);
}
