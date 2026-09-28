/**
 * Where text a reader is shown, or read, is cut.
 *
 * A value quoted by a refusal, the reason a refusal gives and the notice a
 * recovery announces meet in one sentence — a reason quoting a stored value,
 * cut at a word, around a value cut at its own bound — and that sentence
 * reaches an assertive live region and a visible notice at once, so each cut
 * keeps a character whole. They are written in this package, once: the
 * quoting beside this module, and here the cuts it and the others are made
 * by, so another surface has a rule to read rather than one to invent. A
 * reader's own note kept to its size is one, and reads the cut to whole
 * characters; a name held to a bound in characters is another, and reads the
 * cut at a word in characters.
 */

import { LONGEST_CHARACTER, firstCharacters, graphemes, longerThan } from './graphemes.js';

/**
 * What a cut text ends with, to say something was left out: one code unit,
 * and one character to a reader, so it is counted alike in either bound.
 */
const ELLIPSIS = '…';

/**
 * The most of `text` that fits in `bound` code units and ends a whole
 * character, with nothing added to say it was cut.
 *
 * The bound is code units because what every bound here protects is a length:
 * a stored value of megabytes goes into a log, a diagnostic bundle, the status
 * bar and an assertive live region read at the reader as it arrives. Where the
 * bound falls inside a character the cut moves back to the start of it,
 * because half a character is shown as a replacement character and read by a
 * screen reader as nothing at all.
 *
 * What keeps a reader's own text to a size, as a note in a report is kept.
 * Text the application shows or says takes one of the cuts below, which say
 * where something was left out.
 */
export function wholeCharactersWithin(text: string, bound: number): string {
  if (text.length <= bound) return text;

  // Enough of it for the character the bound falls inside to be whole in what
  // the segmenter is given, and no more than that.
  const enough = text.slice(0, bound + LONGEST_CHARACTER);
  let kept = '';

  for (const character of graphemes(enough)) {
    // Also what keeps out a character the allowance cut short: it runs to the
    // end of what was segmented, which is past the bound.
    if (kept.length + character.length > bound) break;
    kept += character;
  }

  return kept;
}

/**
 * `text`, cut to `bound` code units with an ellipsis where anything was cut,
 * the ellipsis counted inside the bound.
 *
 * The plain cut: what a value is quoted at, where there is no word or sentence
 * to prefer. The ellipsis is inside the bound, so a caller passes the room it
 * has and allows for nothing past it.
 */
export function cutToBound(text: string, bound: number): string {
  if (text.length <= bound) return text;
  return `${wholeCharactersWithin(text, bound - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * `text`, cut at the last word that fits in `bound` code units, with an
 * ellipsis where anything was cut, the ellipsis counted inside the bound.
 *
 * What is cut here is read out as well as shown, so a reason quoting a value
 * from a file ends at a word rather than inside one.
 */
export function cutAtAWord(text: string, bound: number): string {
  if (text.length <= bound) return text;
  return atTheLastWord(text, wholeCharactersWithin(text, bound - ELLIPSIS.length));
}

/**
 * `text`, cut at the last word that fits in `characters` characters as
 * {@link longerThan} counts them, with an ellipsis where anything was cut, the
 * ellipsis counted inside the bound.
 *
 * The cut for a text held to a bound a reader is told in characters, such as a
 * name: cut in code units, a name outside the basic plane would keep half the
 * characters its bound allows.
 */
export function cutAtAWordToCharacters(text: string, characters: number): string {
  if (!longerThan(text, characters)) return text;
  return atTheLastWord(text, firstCharacters(text, characters - ELLIPSIS.length));
}

/**
 * `cut`, the start of `text` that leaves room for the ellipsis, taken back to
 * the end of its last word, with the ellipsis after it.
 *
 * A word the cut ends exactly at, which a space follows in `text`, is whole
 * and kept. A single word longer than the cut is cut where it has to be,
 * since there is no boundary to cut at, and that cut is still a whole
 * character.
 */
function atTheLastWord(text: string, cut: string): string {
  const lastWordEnd = text.charAt(cut.length) === ' ' ? cut.length : cut.lastIndexOf(' ');
  return `${(lastWordEnd > 0 ? cut.slice(0, lastWordEnd) : cut).trimEnd()}${ELLIPSIS}`;
}

/** A mark that can end a sentence. */
const SENTENCE_MARK = /[.!?]/u;

/** Space after a sentence, which belongs to it. */
const SPACE = /\s/u;

/**
 * The sentences of `text`: each is everything up to a run of `.`, `!` or `?`
 * that a space or the end of the text follows, with the space after it, or up
 * to the end where there is none.
 *
 * One pass, reading each character at most three times, so a run of marks
 * costs its length rather than its square, and a run at the start of the text
 * belongs to the first sentence.
 */
function sentencesOf(text: string): readonly string[] {
  const sentences: string[] = [];
  let start = 0;
  let at = 0;
  while (at < text.length) {
    if (!SENTENCE_MARK.test(text.charAt(at))) {
      at += 1;
      continue;
    }
    let end = at;
    while (end < text.length && SENTENCE_MARK.test(text.charAt(end))) end += 1;
    if (end === text.length || SPACE.test(text.charAt(end))) {
      while (end < text.length && SPACE.test(text.charAt(end))) end += 1;
      sentences.push(text.slice(start, end));
      start = end;
    }
    at = end;
  }
  if (start < text.length) sentences.push(text.slice(start));
  return sentences;
}

/** Whole sentences from the start of a text, and whether that is all of it. */
export interface SentencesTaken {
  /** The sentences taken, joined by a single space. */
  readonly said: string;

  /** Whether they are the whole of what was given. */
  readonly whole: boolean;
}

/**
 * The whole sentences at the start of `text` that fit in `words` words.
 *
 * Always at least the first sentence, which carries the fact. Cut at a
 * sentence rather than at a word, because half a sentence about losing data is
 * worse than none, and the caller says where the rest of it can be read.
 *
 * What follows the last sentence ending is a sentence of its own, so words
 * after it are said, or counted as left out, rather than dropped while the
 * answer says it is the whole. A full stop with no space after it ends no
 * sentence, so a version a notice quotes, `v1.2`, is said as it was written.
 */
export function sentencesWithin(text: string, words: number): SentencesTaken {
  const found = sentencesOf(text);
  const sentences = found.length === 0 ? [text] : found;
  const said: string[] = [];
  let counted = 0;

  for (const sentence of sentences) {
    const length = sentence.trim().split(/\s+/u).length;
    if (said.length > 0 && counted + length > words) break;
    said.push(sentence.trim());
    counted += length;
  }

  return { said: said.join(' '), whole: said.length === sentences.length };
}
