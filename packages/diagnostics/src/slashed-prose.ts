/**
 * The words a sentence writes with a slash, which the path rules read as prose
 * rather than as folders.
 *
 * No folder's or file's name holds a slash, so a slashed word after a path is
 * either more of its folders or prose, and only the words here are read as
 * prose: each is made only of digits or of the words on a short list, so where
 * one is misread, a folder named `10` or `and` with one named `or` inside it,
 * what the reader sees is those digits or those words and never a name.
 */

/** A date or a fraction written with slashes: `10/10/2026`, `2026/10/10`, `50/50`, `24/7`. */
const SLASHED_NUMBER = /^\d+(?:\/\d+)+$/;

/**
 * The words of a sentence that are written with a slash, lower-cased: each is
 * the slash's own meaning in prose, and never how a folder is named.
 */
const SLASHED_WORDS: ReadonlySet<string> = new Set([
  'and/or',
  'either/or',
  'n/a',
  'w/o',
  'i/o',
  'on/off',
  'yes/no',
  'read/write',
]);

/**
 * Whether a word, with no mark of the sentence before or after it, is a date,
 * a fraction or one of {@link SLASHED_WORDS}.
 */
export function isSlashedProse(word: string): boolean {
  return SLASHED_NUMBER.test(word) || SLASHED_WORDS.has(word.toLowerCase());
}
