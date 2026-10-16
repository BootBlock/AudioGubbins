/**
 * The rule a group's name is held to (ADR-0101), and the key two names are
 * compared by.
 *
 * A name is one segment of a group's path, so it holds no `/`; it is NFC, so
 * two names that look alike are spelled alike; and it has no control character
 * or space at either end, which no person types on purpose and nobody could see
 * to correct. Siblings compare in NFC lower case, as the folders a group's path
 * may become do on a case-insensitive file system.
 */

import { quoted } from '@audiogubbins/text';

/** The most characters, in UTF-16 code units as a channel's label is measured, a group's name holds. */
const LONGEST_NAME = 128;

const PATH_SEPARATOR = '/';
const CONTROL_CHARACTER = /\p{Cc}/u;

/** What is wrong with `name` as a group's name, as a sentence, or `undefined` where nothing is. */
export function groupNameProblem(name: string): string | undefined {
  const characters = name.length;
  if (characters === 0 || characters > LONGEST_NAME) {
    return `A group's name is 1 to ${String(LONGEST_NAME)} characters long; this one is ${String(characters)}.`;
  }
  if (name.includes(PATH_SEPARATOR)) {
    return `A group's name is one segment of its path, so it holds no ${quoted(PATH_SEPARATOR)}; make a group inside another instead.`;
  }
  if (CONTROL_CHARACTER.test(name)) return "A group's name holds no control character.";
  if (name.trim() !== name) return "A group's name has no space at either end.";
  if (name.normalize('NFC') !== name) return "A group's name is written in Unicode's NFC form.";
  return undefined;
}

/** What two names are compared by: equal keys are the same name to a sibling. */
export function groupNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** A group's path as a person reads it: its names from the root, joined by `/`. */
export function pathText(path: readonly string[]): string {
  return path.join(PATH_SEPARATOR);
}
