/**
 * Which of a list of named entries holds a name, and the identifier a new
 * entry is held under beside them.
 *
 * A workspace and a shortcut profile are each held in a list of entries that
 * carry an identifier and a name, and the two lists follow one rule: a name
 * given is refused where an entry has it as a reader hears it, and each entry
 * is held under an identifier derived from its name, within the bound its
 * package gives, numbered where the one derived is held. Written here once, so
 * a condition added to the rule holds for both; each package keeps its own
 * list and bound and words its own refusal.
 */

import {
  identifierOf,
  isIdentifier,
  numberedIdentifier,
  reservedForADevice,
} from './identifiers.js';
import { namesCollator, sameName, spoken } from './names.js';

/** An entry held under an identifier, with the name a reader knows it by. */
export interface Named {
  readonly id: string;
  readonly displayName: string;
}

/**
 * The first of `entries`, other than the one under `self`, whose name is
 * `name` to a reader (see {@link sameName}), or `undefined` where none is.
 *
 * For one question: each reads every entry, so a caller that asks many of
 * one list, as numbering a name does, asks {@link namesHeldBy} instead.
 */
export function holderOf<T extends Named>(
  entries: Iterable<T>,
  name: string,
  self?: string,
): T | undefined {
  for (const entry of entries) {
    if (entry.id !== self && sameName(entry.displayName, name)) return entry;
  }
  return undefined;
}

/** The names a list holds, asked of many times, as numbering a name asks. */
export interface NamesHeld<T extends Named> {
  /** The first entry whose name is `name` to a reader, or `undefined` where none is. */
  readonly holderOf: (name: string) => T | undefined;

  /** Whether an entry has `name` to a reader. */
  readonly taken: (name: string) => boolean;
}

/** An entry with its name as it is said, which the index is sorted by. */
interface Said<T> {
  readonly said: string;
  readonly entry: T;
}

/**
 * The names of `entries`, other than the one under `self`, sorted in the
 * order names are compared in, so each question is a binary search.
 *
 * Numbering a name asks whether "<name>", "<name> 2", "<name> 3" and on are
 * taken until one is free, and a list may hold every one of them, since a
 * stored name is never numbered: asked of every entry each time, a list of
 * thousands would be read thousands of times. Sorted by the collator names
 * are compared by, and searched with it, rather than keyed by a folding of
 * the text, because that collator holds names one that differ in code points
 * it ignores, a soft hyphen or a joiner, which no folding of the text would
 * see: a name is taken exactly where {@link holderOf} would find its holder.
 * Entries of one name keep the order they were given in, so the holder
 * answered is the first of them, as {@link holderOf} answers.
 *
 * @throws NamesCannotBeCompared where names cannot be compared here (see
 * `namesCanBeCompared`), which a caller asks first.
 */
export function namesHeldBy<T extends Named>(entries: Iterable<T>, self?: string): NamesHeld<T> {
  const collator = namesCollator();
  const held: Said<T>[] = [];
  for (const entry of entries) {
    if (entry.id !== self) held.push({ said: spoken(entry.displayName), entry });
  }
  held.sort((one, other) => collator.compare(one.said, other.said));

  const holderOf = (name: string): T | undefined => {
    const said = spoken(name);
    let low = 0;
    let high = held.length;
    // The first entry not before `said`: every one below `low` is before it,
    // and none from `high` on is.
    while (low < high) {
      const middle = (low + high) >>> 1;
      const probe = held[middle];
      if (probe !== undefined && collator.compare(probe.said, said) < 0) low = middle + 1;
      else high = middle;
    }
    const found = held[low];
    return found !== undefined && collator.compare(found.said, said) === 0
      ? found.entry
      : undefined;
  };

  return { holderOf, taken: (name) => holderOf(name) !== undefined };
}

/**
 * The identifiers a list of entries holds, and the one each entry added to it
 * is held under. Each identifier it answers is held from then on, so the next
 * answer is another.
 */
export interface Identifiers {
  /**
   * The identifier derived from `name` (see `identifierOf`), or where that is
   * held, or is a name Windows reserves for a device, it with the first free
   * number from two after it: `mix`, `mix-2`, `mix-3` and on, and `con-2` for
   * "Con".
   */
  forName(name: string): string;

  /**
   * `id`, an identifier read from storage, where it is free, or where it is
   * held, the one {@link Identifiers.forName} derives from it; `undefined`,
   * and nothing held, where `id` is not in the shape an identifier is derived
   * in, or past the bound (see `isIdentifier`).
   *
   * Storage is written by other versions, other tabs and hand edits, and an
   * entry kept under an identifier another holds would take its place. One out
   * of shape is refused rather than derived afresh: the entry under it is
   * stored text that cannot be read, which the reader sets aside and says, as
   * it does any other, where one renamed without a word would be a profile or
   * a workspace the user finds under an identifier they never saw.
   */
  forStored(id: string): string | undefined;
}

/**
 * The identifiers `entries` hold, and those derived within `longest` bytes for
 * entries added beside them, with `fallback` derived where a name leaves
 * nothing to derive one from.
 *
 * A name Windows reserves for a device is numbered as a held one is, so it is
 * never given, whatever the list holds.
 *
 * Each allocation reads the identifiers held as a set, and starts counting a
 * derived identifier's numbers where the last count under it stopped, so an
 * allocation costs about the same however many entries share its identifier,
 * and a whole list read from storage is held in time that grows with its
 * length alone. Nothing it holds is ever let go: it lives for one addition,
 * or for one reading of a stored list, over entries that only grow, so every
 * number below where a count stopped is still held, and the first free number
 * is still where the count resumes.
 */
function identifiersHeldBy(
  entries: Iterable<{ readonly id: string }>,
  fallback: string,
  longest: number,
): Identifiers {
  const held = new Set<string>();
  for (const entry of entries) held.add(entry.id);
  const nextNumber = new Map<string, number>();
  const numbered = (base: string, number: number): string =>
    numberedIdentifier(base, number, fallback, longest);

  const heldFree = (base: string): string => {
    let id = base;
    if (held.has(base) || reservedForADevice(base)) {
      let number = nextNumber.get(base) ?? 2;
      while (held.has(numbered(base, number))) number += 1;
      nextNumber.set(base, number + 1);
      id = numbered(base, number);
    }
    held.add(id);
    return id;
  };

  return {
    forName: (name) => heldFree(identifierOf(name, fallback, longest)),
    forStored: (id) => {
      if (!isIdentifier(id, longest)) return undefined;
      return heldFree(id);
    },
  };
}

/** The identifier rule held to one bound, which a package gives once. */
export interface IdentifierRule {
  /**
   * Whether `text` is an identifier the rule gives, which an identifier read
   * from storage is held to (see `isIdentifier`).
   */
  isIdentifier(text: string): boolean;

  /**
   * The identifiers `entries` hold, and those the rule gives entries added
   * beside them, with `fallback` derived where a name leaves nothing to derive
   * one from (see {@link Identifiers}).
   */
  identifiersHeldBy(entries: Iterable<{ readonly id: string }>, fallback: string): Identifiers;
}

/**
 * The identifier rule within `longestBytes` bytes in UTF-8: which identifiers
 * it accepts, and the one it gives each entry added to a list.
 *
 * The bound is the caller's, because what sets it is where the caller keeps an
 * identifier: the room a file name leaves it after an ending the caller writes,
 * or what storage holds. Every identifier the rule gives is one it accepts,
 * where the bound has room for the caller's fallback with a number after it. A
 * bound that is not a whole number of bytes, at least one, is refused where the
 * rule is made, since the rule would refuse every identifier read from storage.
 *
 * @throws RangeError where `longestBytes` is not a whole number of at least
 * one.
 */
export function identifierRule(longestBytes: number): IdentifierRule {
  if (!Number.isSafeInteger(longestBytes) || longestBytes < 1) {
    throw new RangeError(
      `An identifier is held to a whole number of bytes, at least one, not ${String(longestBytes)}.`,
    );
  }
  return {
    isIdentifier: (text) => isIdentifier(text, longestBytes),
    identifiersHeldBy: (entries, fallback) => identifiersHeldBy(entries, fallback, longestBytes),
  };
}
