/**
 * The shape of a name a reader gives, when two names are one, the first name
 * free of those in use, and what a copy is called.
 *
 * A workspace and a shortcut profile each carry a name that is drawn in a list
 * and said whole in a live region, typed by a reader or read from storage or a
 * file. The shape of the rule is one for both, and written here: a name is text
 * with something in it a reader sees besides space, within its bound in the
 * characters a reader sees, and a name given is held without the space around
 * it. Each package words the answer for its own reader, and gives the word a
 * copy's name adds.
 */

import { cutAtAWordToCharacters } from './cutting.js';
import { charactersIn, longerThan } from './graphemes.js';

/**
 * Which part of the rule refuses a name: `blank` for one of nothing but space
 * and code points a reader does not see, or that is not text at all;
 * `too-long` for one past its bound.
 *
 * The part rather than a sentence, so a caller words a refusal by the part
 * that refused, and a condition added to the rule is not reported as another.
 */
export interface NameProblem {
  readonly kind: 'blank' | 'too-long';
}

/**
 * A code point a reader does not see: a name of nothing else, and space, reads
 * as blank as one of space alone, and the Hangul fillers among them are
 * letters, which trimming a name leaves.
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/** Which part of the rule refuses `name`, read without the space around it. */
function problemOf(name: string, characters: number): NameProblem | undefined {
  if (name.replaceAll(INVISIBLE, '').trim() === '') return { kind: 'blank' };
  return longerThan(name, characters) ? { kind: 'too-long' } : undefined;
}

/**
 * `value` as a name given within `characters` characters, without the space
 * around it, or which part of the rule refuses it.
 *
 * A name typed, carried in a file or given to a copy is trimmed before the
 * rule reads it and before it is numbered: the space around a name is neither
 * seen in a list nor heard in a live region, and a name kept with it would be
 * numbered apart from the name the reader sees, " mine" as " mine 2".
 *
 * Takes `unknown`, because a name is read from storage and from files as well
 * as typed: a value that is not text is no name, refused as a blank one is, so
 * a reader of a stored name words that refusal once.
 */
export function asName(value: unknown, characters: number): string | NameProblem {
  if (typeof value !== 'string') return { kind: 'blank' };
  const name = value.trim();
  return problemOf(name, characters) ?? name;
}

/**
 * `value` as a name written in stored text, as it is written, or which part of
 * the rule refuses it: held to the rule as {@link asName} holds it, space
 * around it and all kept, so a stored name is read as it was stored.
 */
export function asWrittenName(value: unknown, characters: number): string | NameProblem {
  if (typeof value !== 'string') return { kind: 'blank' };
  return problemOf(value.trim(), characters) ?? value;
}

/**
 * How two names are compared: a letter and its capital are one, and a letter
 * written as one code point or as a letter and a combining mark is one, while
 * a letter with an accent and one without are two, and so are two names that
 * differ in a mark of punctuation.
 *
 * One rule on every machine, English collation with every option that decides
 * whether two names are one stated, because a name travels: an exported
 * profile is imported on another machine, whose browser may speak another
 * language, and a name refused or numbered there must be refused or numbered
 * here. Left to the reader's locale, Turkish would hold "MIXING" and "mixing"
 * to be two names, Danish "Gaard" and "Gård" to be one, and Thai would ignore
 * punctuation, so "Mixing-desk" would be "Mixing desk". Digits are compared
 * as they are written, so "Mix 01" and "Mix 1" are two names. A runtime that
 * cannot give this rule compares no names at all (see {@link collation}).
 */
const NAMES: Intl.CollatorOptions = {
  usage: 'search',
  sensitivity: 'accent',
  ignorePunctuation: false,
  numeric: false,
};

/**
 * The collator names are compared by, or why this runtime cannot give it: a
 * runtime without English collation, or one that ignores punctuation or reads
 * digits as numbers, would compare names by another rule, and a name would be
 * refused on one machine and taken on the next; one that cannot make the
 * collator compares names by no rule at all.
 */
type Collation = { readonly collator: Intl.Collator } | { readonly refusal: string };

/** The collation {@link collation} resolved, kept from its first use. */
let resolved: Collation | undefined;

/**
 * The collation names are compared by, resolved once and held to the one rule
 * at the capability probe at start or at the first comparison, whichever comes
 * first, and never where the package loads: the rule is naming's alone, and a
 * runtime that fails it still counts characters, cuts a sentence and quotes a
 * value for every package that reads the others. A constructor that throws is
 * a runtime that fails it, answered as one, so the probe and every caller read
 * one answer and the constructor is asked once.
 */
function collation(): Collation {
  if (resolved !== undefined) return resolved;
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator('en', NAMES);
  } catch {
    // Whatever it throws, the runtime cannot give the rule, which is naming's
    // to refuse and say, never an error for the start or a caller to meet.
    resolved = {
      refusal:
        'Names are compared by English collation, and this runtime cannot make a collator for it.',
    };
    return resolved;
  }
  const { locale, ignorePunctuation, numeric } = collator.resolvedOptions();
  if (locale.startsWith('en') && !ignorePunctuation && !numeric) {
    resolved = { collator };
  } else {
    const ignoring = ignorePunctuation ? ', ignoring punctuation' : '';
    const numbers = numeric ? ', reading digits as numbers' : '';
    resolved = {
      refusal: `Names are compared by English collation, punctuation and digits as they are written, and this runtime resolved "${locale}"${ignoring}${numbers}.`,
    };
  }
  return resolved;
}

/**
 * Whether this runtime compares names by the one rule (see {@link NAMES}).
 *
 * The one statement of the check: every comparison of two names reads it, and
 * so does a caller that must finish without one, which asks it first and
 * keeps a name as it is, or refuses to name anything, and says why.
 */
export function namesCanBeCompared(): boolean {
  return 'collator' in collation();
}

/**
 * A comparison of two names asked on a runtime that cannot compare them by the
 * one rule: a caller's fault, since every caller that names asks
 * {@link namesCanBeCompared} first, and refused rather than answered by
 * another rule.
 */
class NamesCannotBeCompared extends Error {
  override readonly name = 'NamesCannotBeCompared';
}

/**
 * The collator two names are compared by, spoken (see {@link spoken}): the
 * order of names {@link sameName} and a sorted list of names read alike.
 *
 * @throws NamesCannotBeCompared where {@link namesCanBeCompared} does not hold.
 */
export function namesCollator(): Intl.Collator {
  const answer = collation();
  if ('refusal' in answer) throw new NamesCannotBeCompared(answer.refusal);
  return answer.collator;
}

/** A run of space inside a name, which is said as one space. */
const SPACE_RUN = /\s+/gu;

/**
 * Whether two names are one to a reader.
 *
 * A screen reader says "Mixing" and "mixing" alike, and a list shows them, or
 * two names that differ only in the space around or inside them, as one name
 * at a glance. So two names are one where they differ only in case, in how a
 * letter is encoded, or in space: trimmed, each run of space inside them read
 * as one space, and compared by {@link NAMES}.
 *
 * @throws NamesCannotBeCompared where {@link namesCanBeCompared} does not hold.
 */
export function sameName(one: string, other: string): boolean {
  return namesCollator().compare(spoken(one), spoken(other)) === 0;
}

/** A name as it is said: without the space around it, and each run inside it one space. */
export function spoken(name: string): string {
  return name.trim().replaceAll(SPACE_RUN, ' ');
}

/** A name, then a run of space and a number, as a series numbers a name. */
const A_NUMBERED_NAME = /^(?<name>.*\S)\s+[0-9]+$/su;

/** A run of space, kept where a name is split at it. */
const BETWEEN_WORDS = /(\s+)/u;

/**
 * The name a copy's name `given` is in the series of, where it is one: the
 * words before `word` at its end, perhaps with a number after that, `word`
 * read as {@link sameName} reads a name, so "Editing Copy", "Editing  copy"
 * and "Editing COPY 2" are each a copy of "Editing". `undefined` where `given`
 * is no copy's name, or `word` is all of it.
 */
function stemOfACopy(given: string, word: string): string | undefined {
  const unnumbered = A_NUMBERED_NAME.exec(given)?.groups?.['name'] ?? given;
  // The words at even places, the space between them at odd ones.
  const parts = unnumbered.split(BETWEEN_WORDS);
  const wordStarts = parts.length - (spoken(word).split(' ').length * 2 - 1);
  if (wordStarts < 2 || !sameName(parts.slice(wordStarts).join(''), word)) return undefined;
  return parts.slice(0, wordStarts - 1).join('');
}

/**
 * The first name `taken` does not refuse of `name` without the space around
 * it, with `addition` after it, then with a number after that:
 * "<name><addition>", "<name><addition> 2", "<name><addition> 3" and on.
 *
 * Within `characters`, the bound every such name is held to, so a name made
 * from one near the bound is not refused over a name the reader never typed:
 * `name` is cut at a word, in the characters the bound counts, to leave room
 * for what follows it, counted in the same characters, since a word a package
 * gives may be written in any script.
 */
function firstFree(
  name: string,
  addition: string,
  characters: number,
  taken: (name: string) => boolean,
): string {
  const given = name.trim();
  for (let number = 1; ; number += 1) {
    const after = number === 1 ? addition : `${addition} ${String(number)}`;
    const candidate = `${cutAtAWordToCharacters(given, characters - charactersIn(after))}${after}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * The first name `taken` does not refuse of `name`, trimmed, then "<name> 2",
 * "<name> 3" and on, within `characters` (see {@link firstFree}).
 */
export function firstFreeName(
  name: string,
  characters: number,
  taken: (name: string) => boolean,
): string {
  return firstFree(name, '', characters, taken);
}

/**
 * What a copy of what is called `name` is called when nobody chose its name:
 * the first of "<name> <word>", "<name> <word> 2", "<name> <word> 3" and on
 * that `taken` does not refuse, within `characters` (see {@link firstFree}).
 * `word` is what a copy's name adds, which the package that names the copy
 * gives in its reader's words, as "copy".
 *
 * A name that is itself a copy's, "<stem> <word>" or "<stem> <word> <number>",
 * gives its copy the stem's next free number, so a copy of "Editing copy" is
 * "Editing copy 2" and never "Editing copy copy", a name that grows with each
 * copy of a copy and says nothing the number does not. The word and the space
 * before it and the number are read as {@link sameName} reads a name, so a copy
 * of "Editing Copy", which a reader hears as "Editing copy", is in its series
 * too. A name a reader typed that ends in the word is read as a copy's alike.
 */
export function firstFreeCopyName(
  name: string,
  word: string,
  characters: number,
  taken: (name: string) => boolean,
): string {
  const given = name.trim();
  return firstFree(stemOfACopy(given, word) ?? given, ` ${word}`, characters, taken);
}
