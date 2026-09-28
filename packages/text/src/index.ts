/**
 * The public contract of AudioGubbins text: the rules a sentence shown to a
 * reader, or read to one, is held to.
 *
 * A leaf, below everything, because the packages that need these rules share
 * nothing else: the keyboard settings name a character by it, a refusal in the
 * command layer and in the workspace quotes a value by it, the two hold a name
 * a reader gave to its shape by it, find which entry holds a name by it, name a
 * copy nobody named by it and hold each entry under an identifier derived from
 * its name, which storage and a message quote, and hold one read from storage
 * to the shape it is derived in by it, each within the bound in bytes it gives,
 * a report keeps a reader's note to its size by it, and the application cuts a
 * reason and a notice by it. A rule written in the package that needs it first
 * could not be read by another beside it, and two copies of one rule would cut
 * the same character in different places.
 *
 * What the rules are built from — the segmenter, the count of characters, the
 * comparison of two names, the cut to a bound that adds an ellipsis — stays
 * inside: a caller that reached for those would be writing another rule
 * rather than reading one of these. Whether this runtime compares names by
 * the rule is offered, and checked once, at the capability probe at start or
 * at the first comparison, whichever comes first, never where the package
 * loads, so a runtime that cannot stops naming alone.
 *
 * Nothing here knows the browser, the domain or a command. It is text.
 */

export { oneCharacter } from './graphemes.js';

export {
  type SentencesTaken,
  cutAtAWord,
  sentencesWithin,
  wholeCharactersWithin,
} from './cutting.js';

export {
  type IdentifierRule,
  type Identifiers,
  type Named,
  type NamesHeld,
  holderOf,
  identifierRule,
  namesHeldBy,
} from './holders.js';

export { utf8Bytes } from './identifiers.js';

export {
  type NameProblem,
  asName,
  asWrittenName,
  firstFreeCopyName,
  firstFreeName,
  namesCanBeCompared,
} from './names.js';

export { asQuoted } from './quoting.js';
