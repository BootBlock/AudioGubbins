/**
 * The characters a reader sees, which is not what `String.prototype.length`
 * counts.
 *
 * A string's length is code units. One character a reader sees may be two of
 * them for anything outside the basic plane, three or more for a letter
 * carrying combining marks, and a dozen for an emoji built from a sequence.
 * Every rule in this package that counts characters counts these, and counts a
 * character longer than {@link LONGEST_CHARACTER} once for each allowance it
 * fills, so a count of characters is a bound on size as well. A cut to a bound
 * in code units keeps these whole, and counts code units.
 */

/**
 * As near as a pattern comes to a character a reader sees: a line ending, a
 * flag's two regional indicators, a pictograph with its marks and skin tone
 * and the pictographs joined to it, or a code point and the combining marks
 * after it.
 *
 * A flag, a skin tone and a family are each read whole, as a line ending is.
 * Still read as parts: Hangul written as its jamo, an Indic conjunct joined by
 * a virama, and a flag spelt with tag characters.
 */
const MARKED =
  /\r\n|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[\p{M}\p{Emoji_Modifier}]*(?:\u{200D}\p{Extended_Pictographic}[\p{M}\p{Emoji_Modifier}]*)*|\P{M}\p{M}*|\p{M}+/gu;

/**
 * The characters a reader sees in `text`, one at a time, so a caller that
 * needs the first few reads no further than them.
 *
 * Built at module scope, `new Intl.Segmenter(...)` would throw while the module
 * loads on any browser without it, and the shell would never start. Firefox has
 * it from 125, inside the `firefox115` the build declares, so it is built when
 * it is first needed. Where it is missing, a character is a code point with the
 * combining marks after it, which keeps a letter with the accent a reader sees
 * on it, and the emoji sequences `MARKED` names are kept whole; what it names
 * as still read in parts is read so there.
 */
export const graphemes = (() => {
  let segmenter: Intl.Segmenter | undefined;
  return function* characters(text: string): Generator<string, void, undefined> {
    if (typeof Intl.Segmenter !== 'function') {
      for (const [character] of text.matchAll(MARKED)) yield character;
      return;
    }
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const one of segmenter.segment(text)) yield one.segment;
  };
})();

/**
 * The most code units this package reads one character a reader sees as.
 *
 * An allowance rather than a limit, used two ways, because the two bounds
 * differ. A cut to a bound of code units knows how far it can reach, so it
 * hands the segmenter the bound and this much more: a character that ends at
 * the bound is then seen to end there rather than to run on, and one that
 * runs on past the bound is seen to, and left out. A count to a bound of
 * characters cannot know how far that is in code units, so it reads a part at
 * a time instead, and a character longer than this counts once for each
 * allowance it fills. A flag is four code units and an emoji built from a
 * sequence about a dozen, so this is generous, and a value a refusal was
 * given may be megabytes long, so it cannot simply be the whole text.
 */
export const LONGEST_CHARACTER = 32;

/** How much of a text the segmenter is handed at a time, in code units. */
const PART = 1024;

/**
 * How many characters a reader sees `text` holds, a character longer than
 * {@link LONGEST_CHARACTER} counting once for each allowance it fills, counted
 * no further than `limit`.
 *
 * Read a part at a time, because the segmenter takes in the whole of the text
 * it is handed before it gives back the first character: handed a name of
 * megabytes, the count would cost the megabytes however few characters it
 * reads. Each part begins where a character does, so it is segmented as the
 * whole text would be.
 *
 * A character longer than {@link LONGEST_CHARACTER} counts once for each
 * allowance it fills. A letter carries any number of combining marks and is
 * one character to a reader, so counted once a name of 120 of them could be
 * a hundred thousand code units in a live region; counted so, a text within
 * a bound of characters is within a bound of size as well.
 */
function countedTo(text: string, limit: number): number {
  let count = 0;
  let from = 0;
  let size = PART;

  while (count < limit && from < text.length) {
    const part = text.slice(from, from + size);
    const reachesTheEnd = from + part.length === text.length;
    let taken = 0;

    for (const character of graphemes(part)) {
      // One running to the end of the part may go on past it, so it is read
      // again from its start in the next.
      if (!reachesTheEnd && taken + character.length === part.length) break;
      taken += character.length;
      count += Math.ceil(character.length / LONGEST_CHARACTER);
      if (count >= limit) return limit;
    }

    // A single character longer than the part is read in a wider one, until
    // what has been read of it fills the rest of the count, after which
    // reading further changes nothing.
    if (taken === 0) {
      if (part.length >= (limit - count) * LONGEST_CHARACTER) return limit;
      size *= 2;
    } else {
      from += taken;
      size = PART;
    }
  }

  return count;
}

/**
 * Whether `text` is one character as a reader sees one, no longer than
 * {@link LONGEST_CHARACTER}.
 *
 * A character longer than that counts as several, as it does in every count
 * here. No key types one, and the reading a key event gives is the text this
 * is asked of.
 */
export function oneCharacter(text: string): boolean {
  return countedTo(text, 2) === 1;
}

/**
 * Whether `text` holds more than `characters` characters as a reader sees
 * them.
 *
 * What a bound a reader is told in characters has to count: a name of a
 * hundred emoji is a hundred characters to them and several hundred code
 * units. A character longer than any real one counts for each allowance it
 * fills, so the bound holds the size too. It reads no further than the
 * bound, so a text of any size costs about as much as the bound does.
 */
export function longerThan(text: string, characters: number): boolean {
  return countedTo(text, characters + 1) > characters;
}

/**
 * How many characters a reader sees `text` holds, counted as
 * {@link longerThan} counts them.
 *
 * Reads the whole text, so it is for text whose size the caller sets, such as
 * the words a name is given after it, never for a value read from outside.
 */
export function charactersIn(text: string): number {
  return countedTo(text, Number.POSITIVE_INFINITY);
}

/**
 * The most of `text` from its start that holds no more than `characters`
 * characters, counted as {@link longerThan} counts them.
 *
 * The segmenter is handed what that many characters can take up and one
 * allowance more. A character kept ends at least an allowance before the end
 * of what it is handed, so it is seen whole; one that the end of it cuts short
 * already counts for more than the room left, and is left out as the whole of
 * it would be.
 */
export function firstCharacters(text: string, characters: number): string {
  const enough = text.slice(0, (characters + 1) * LONGEST_CHARACTER);
  let kept = '';
  let count = 0;

  for (const character of graphemes(enough)) {
    count += Math.ceil(character.length / LONGEST_CHARACTER);
    if (count > characters) break;
    kept += character;
  }

  return kept;
}
