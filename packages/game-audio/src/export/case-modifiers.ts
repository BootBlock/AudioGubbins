/**
 * The case a naming template's text token is written in (ADR-0102).
 *
 * `lower` and `upper` map the whole text. The others write its words: a word
 * is a run of letters and digits, the marks that follow a letter kept with
 * it, so a script whose vowels are combining marks stays one word; anything
 * else separates words and is dropped. `snake` joins the words in lower case
 * with `_`, `kebab` with `-`, and `pascal` upper-cases each word's first code
 * point and lower-cases the rest. The text is NFC first, and the case mapping
 * is `toLowerCase` and `toUpperCase`, which are the same in every locale.
 */

/** The case modifiers, in the order a refusal lists them. */
export const CASE_MODIFIERS = ['lower', 'upper', 'snake', 'kebab', 'pascal'] as const;

export type CaseModifier = (typeof CASE_MODIFIERS)[number];

/** A word: a letter or digit, then letters, digits and the marks that combine with them. */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;

function wordsOf(text: string): readonly string[] {
  return text.match(WORD) ?? [];
}

function capitalised(word: string): string {
  const first = word.codePointAt(0) ?? 0;
  const head = String.fromCodePoint(first);
  return head.toUpperCase() + word.slice(head.length).toLowerCase();
}

/** `text` written in the case `modifier` names. */
export function inCase(text: string, modifier: CaseModifier): string {
  const normal = text.normalize('NFC');
  switch (modifier) {
    case 'lower':
      return normal.toLowerCase();
    case 'upper':
      return normal.toUpperCase();
    case 'snake':
      return wordsOf(normal).join('_').toLowerCase();
    case 'kebab':
      return wordsOf(normal).join('-').toLowerCase();
    case 'pascal':
      return wordsOf(normal).map(capitalised).join('');
  }
}
