/**
 * The identifier a thing a reader named is held under, derived from its name.
 *
 * A workspace and a shortcut profile are each held under an identifier that
 * storage keys, a message quotes and a file may be named after, so the
 * identifier is text a reader can be shown, and one rule derives it for both,
 * and one predicate holds an identifier read from storage to the shape it is
 * derived in. The bound, in UTF-8 bytes, is each caller's, since what sets it
 * is where the caller keeps the identifier, which nothing here knows. Which
 * identifiers are held, and the number that sets a derived one apart from one
 * held or from a name Windows reserves, is `holders.ts`; each package gives its
 * own word for a name with nothing in it an identifier can keep.
 */

import { LONGEST_CHARACTER, graphemes } from './graphemes.js';

/**
 * A run of code points a reader sees nothing of, not even a gap: every
 * default-ignorable code point but a letter, so a variation selector, a
 * joiner, a soft hyphen, a zero-width space, a tag, and one not yet assigned,
 * which a runtime that does not know it shows as nothing. Left out of a name
 * before anything else reads it, so the letters either side of one join as a
 * reader sees them joined, and a mark after one reaches the letter before it,
 * which the compatibility form then composes it with.
 */
const UNSEEN = /(?:(?!\p{L})\p{Default_Ignorable_Code_Point})+/gu;

/**
 * A run of what an identifier derived from a name reads as a gap, and holds as
 * one hyphen: anything but a letter, a mark or a digit, in any script, and the
 * Hangul fillers, the default-ignorable code points {@link UNSEEN} leaves,
 * which are letters a reader sees as a blank gap, as they see a space. Kept, a
 * name of a filler alone would be held under an identifier that reads as
 * nothing, and a filler inside a name would make its identifier read as
 * another.
 */
const NOT_IN_AN_IDENTIFIER = /(?:[^\p{L}\p{M}\p{N}]|\p{Default_Ignorable_Code_Point})+/gu;

/** The hyphens a derived identifier would start or end with. */
const HYPHENS_AT_THE_ENDS = /^-+|-+$/gu;

/** The hyphens an identifier cut short would end with. */
const HYPHENS_AT_THE_END = /-+$/u;

/**
 * The names Windows reserves for a device, as an identifier derives them: a
 * file whose name before its first dot is one of these is reserved whatever
 * its extension, so a browser renames a download named so, and the file saved
 * is not the file named.
 */
const DEVICE_NAMES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/u;

/**
 * Whether `identifier`, derived from a name, is one Windows reserves for a
 * device (see {@link DEVICE_NAMES}), which is never an identifier.
 */
export function reservedForADevice(identifier: string): boolean {
  return DEVICE_NAMES.test(identifier);
}

/**
 * How many bytes `text` takes in UTF-8, which is what a file system counts a
 * name in: one for an ASCII character, two or three for any other in the basic
 * plane, four for one outside it, and three for half a surrogate pair, which
 * is written as the replacement character.
 */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Whether `text` is an identifier this package gives within `longest` bytes:
 * not empty, no longer than the bound, no name Windows reserves for a device,
 * and its own identifier (see {@link identifierOf}), so letters, marks and
 * digits of any script that a reader sees, in their compatibility form and
 * lower case, in runs joined by single hyphens, with no hyphen at either end.
 *
 * Every identifier the package gives is one: one derived from a name is its own
 * identifier, and so is one cut to the bound, which ends a whole character, and
 * one numbered (see {@link numberedIdentifier}), whose number follows a hyphen;
 * a name Windows reserves is numbered before it is given. Nothing else is.
 *
 * What an identifier read from storage is held to. Storage is written by other
 * versions, other tabs and hand edits, and an identifier is where storage keeps
 * an entry, text a message quotes and what a file may be named after: one of
 * any length, or carrying a separator, a line break, a control character, a
 * character that turns the text around or a letter a reader does not see, or a
 * name Windows reserves, would be a file saved under another name, or somewhere
 * else, and a message a reader is misled by, and one in a case or a form no
 * name derives would sit beside the identifier its name derives, as two entries
 * a reader cannot tell apart.
 */
export function isIdentifier(text: string, longest: number): boolean {
  // The length first: each code unit is at least a byte, so a text of
  // megabytes is refused before anything reads it, and one within the bound
  // is its own identifier only where the derivation leaves it whole.
  return (
    text !== '' &&
    text.length <= longest &&
    !reservedForADevice(text) &&
    identifierOf(text, '', longest) === text
  );
}

/**
 * The most of `identifier` from its start that takes no more than `bytes`
 * bytes and ends a whole character, with no hyphen at its end.
 *
 * A whole character a reader sees, so a letter keeps the marks a reader sees
 * on it. The segmenter is handed the bound and one allowance more: each code
 * unit is at least a byte, so a character cut short by that is longer than
 * the room left and is left out as the whole of it would be.
 */
function cutToBytes(identifier: string, bytes: number): string {
  if (utf8Bytes(identifier) <= bytes) return identifier;

  let kept = '';
  let size = 0;
  for (const character of graphemes(identifier.slice(0, bytes + LONGEST_CHARACTER))) {
    const more = utf8Bytes(character);
    if (size + more > bytes) break;
    kept += character;
    size += more;
  }
  return kept.replace(HYPHENS_AT_THE_END, '');
}

/**
 * The identifier derived from `name` within `longest` bytes: with each code
 * point a reader sees nothing of left out (see {@link UNSEEN}), its
 * compatibility form (NFKC) in lower case, each run of anything but a letter, a
 * mark or a digit, and each Hangul filler, one hyphen, no hyphen at either end,
 * and `fallback` where nothing is left.
 *
 * Letters, marks and digits of every script are kept, so "Écoute" is `écoute`
 * and "Мои клавиши" is `мои-клавиши`, readable where storage or a message
 * quotes it, and a mark stays on the letter a reader sees it on. The
 * compatibility form first, so a ligature, a letter written in full width or a
 * Roman numeral gives the letters it is read as. The lower case is the one
 * without a locale, so a name gives one identifier on every machine. An
 * identifier of lower-case ASCII letters and digits joined by single hyphens is
 * its own.
 *
 * A long name's identifier is cut at a whole character to the bound, so every
 * identifier derived is within it: 120 letters in Cyrillic take 240 bytes, and
 * within 227 are cut to 113. One Windows reserves for a device is derived as it
 * is, and numbered where it is given (see `identifierRule`).
 */
export function identifierOf(name: string, fallback: string, longest: number): string {
  const derived = name
    .replaceAll(UNSEEN, '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(NOT_IN_AN_IDENTIFIER, '-')
    .replaceAll(HYPHENS_AT_THE_ENDS, '');
  return cutToBytes(derived, longest) || fallback;
}

/**
 * `identifier` numbered `number`: `mix-2` for `mix` and two, with as much of
 * `identifier` as leaves room for the number within `longest` bytes, or
 * `fallback` numbered where no whole character of it does.
 *
 * Cut before it is numbered, so a numbered identifier is still one
 * {@link isIdentifier} accepts within the bound, and still says the number it
 * was given.
 */
export function numberedIdentifier(
  identifier: string,
  number: number,
  fallback: string,
  longest: number,
): string {
  const suffix = `-${String(number)}`;
  const stem = cutToBytes(identifier, longest - suffix.length) || fallback;
  return `${stem}${suffix}`;
}
