/**
 * What a run of name characters is, for every rule that reads one.
 *
 * The credential rules and the path rules find different things and share no
 * other code, but both have to agree on where a name begins and where a quote
 * is the inside of a word. Each rule below is written here once: written out in
 * both modules, with the same doc, a change to one copy would change half the
 * behaviour.
 */

/** A character that makes a quote the inside of a word, as in `O'Brien`. */
export const WORD_CHARACTER = /\w/;

/** Every separator inside a name: `sourceFilePath`, `source_file`, `connect.sid`. */
const NAME_SEPARATOR = String.raw`[-_\s.]+`;

/** Splits `sourceFilePath`, `source_file`, `source-file` and `connect.sid` into their words. */
const FIELD_WORD_BOUNDARY = new RegExp(String.raw`(?<=[a-z0-9])(?=[A-Z])|${NAME_SEPARATOR}`);

/** Every separator in a name, to join its words. */
export const NAME_SEPARATORS = new RegExp(NAME_SEPARATOR, 'g');

/** The words of a field's name, lower-cased: `sourceFilePath` is `source`, `file`, `path`. */
export function fieldWords(name: string): readonly string[] {
  return name.split(FIELD_WORD_BOUNDARY).map((word) => word.toLowerCase());
}

/**
 * Where a rule may start reading a name or a scheme: at the start of a run of
 * the characters it is written in, and never inside one.
 *
 * A run does not always begin with a letter: `users[0].password=hunter2`,
 * `user?.password`, `2.token=abc` and
 * `Retrying (2/3)...postgres://admin:hunter2@host/app` each begin a name or a
 * scheme after a dot or a digit, and a rule that refused every dot would read
 * none of them and keep the secret whole. The characters of the run before its
 * first letter are taken into the match instead, as a word written straight
 * against one already is: `Connecting...postgres://…` goes whole.
 *
 * The lookbehind refuses every character the run can hold, and the run's start
 * takes only those characters, both from the one list, so a run has exactly one
 * start and is read once. Two lists kept apart could drift: were a run able to
 * begin with a character the lookbehind does not refuse, every one of them in a
 * run would be a start of its own, and each would read the rest of the run
 * before failing, so a run of a hundred thousand dollar signs would take ten
 * seconds.
 */
export interface Run {
  /** Refuses a start inside a run: the character before is none of the run's. */
  readonly notInside: string;
  /** The run from its start to its first letter. */
  readonly leading: string;
  /** The run from its start to its first letter, and the name from that letter on. */
  readonly name: string;
}

/** A run of `characters`, which must hold every ASCII letter. */
function runOf(characters: string): Run {
  const leading = String.raw`(?:(?![A-Za-z])[${characters}])*`;
  return {
    notInside: String.raw`(?<![${characters}])`,
    leading,
    name: String.raw`${leading}[A-Za-z][${characters}]*`,
  };
}

/**
 * A name given a value: letters, digits, `_`, and the dots, dollar signs and
 * hyphens that `users.password`, `$password` and `--password` are written with.
 */
export const NAME_RUN: Run = runOf(String.raw`\w.$\-`);

/**
 * A scheme, as RFC 3986 writes one: letters, digits, `+`, `-` and `.`. Not the
 * underscore, so a scheme written straight after one, `a_postgres://`, starts
 * after it: begun at the `a`, the run would hold an underscore, which is no
 * part of a scheme, and the address, password and all, would be kept whole.
 */
export const SCHEME_RUN: Run = runOf(String.raw`A-Za-z0-9+.\-`);
