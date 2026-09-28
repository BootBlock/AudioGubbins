/**
 * Finding a credential in text, and in a field's name.
 *
 * The part of redaction that reads secrets: the shapes a key or a token has,
 * the names a secret is given, and where a value given to one ends. Apart from
 * the rest of redaction, which finds paths, names and addresses, because the
 * two share only the placeholder, which the caller supplies, the rules in
 * `text-runs.ts` that say what a run of name characters is, which both read a
 * text by, and where an address ends, which is the path rules' to say.
 */

import { addressEnd, indexQuotes, type QuoteIndex } from './path-finding.js';
import { NAME_RUN, NAME_SEPARATORS, SCHEME_RUN, WORD_CHARACTER, fieldWords } from './text-runs.js';

/*
 * Every pattern below that is global is used through `String.replace` or
 * `matchAll`, each of which starts from the beginning of the text whatever
 * position the pattern was left at, so the patterns are safe to share between
 * calls. The one sticky pattern is positioned before each use.
 */

/**
 * Credentials that can be recognised by their shape alone.
 *
 * The labelled forms are matched elsewhere. These are the ones that arrive in
 * prose with nothing to label them: a JSON web token, which is three base64
 * segments with two dots, and the vendor key prefixes that are designed to be
 * recognisable so that a leak can be revoked.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  // The claims are in the first two segments, and the signature can be short or
  // empty: a token signed with `none`, or one cut short in an error message. A
  // token cut short before its second dot still carries its claims, so two
  // segments are enough when the second is long enough to be a payload.
  //
  // Read from the start of its run rather than from every hyphen before a `J`:
  // a word boundary holds between a hyphen and the `e`, so were it read from
  // each of them, a run of hyphens would be read whole once for each hyphen
  // before the match failed.
  /(?<![\w-])eyJ[\w-]{8,}\.(?:[\w-]{8,}\.[\w-]*|[\w-]{16,})/g,
  // OpenAI writes these with a hyphen and Stripe with an underscore.
  // OpenAI's project and service keys and Anthropic's carry a second prefix
  // after the first hyphen, which a run of letters alone does not allow.
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g,
  /\bAIza[\w-]{35}(?![\w-])/g,
  /\bgithub_pat_\w{22,}/g,
  /\bglpat-[\w-]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bSG\.[\w-]{22}\.[\w-]{43}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bya29\.[\w-]{16,}/g,
  /\b(?:whsec|hf)_[A-Za-z0-9]{20,}/g,
  /\bxapp-[\w-]{20,}/g,
  /\bpypi-[\w-]{50,}/g,
  /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g,
  /\bdo[opr]_v1_[a-f0-9]{64}\b/g,
  /\bglrt-[\w-]{20,}/g,
  // A Telegram bot's token: the bot's number, a colon, and its secret.
  /\b\d{8,10}:AA[\w-]{33}(?![\w-])/g,
  // A key written out, header to footer, or to the end of the text when an
  // error cut it short: the body alone is the secret. A PGP key's header
  // carries words after `PRIVATE KEY`, and is matched with them. Each run of
  // words around `PRIVATE KEY` is as long as the longest a key type writes, and
  // no longer: unbounded, a header that never closes would be split at every
  // `PRIVATE KEY` in it, and a long one would take seconds.
  /-----BEGIN [A-Z ]{0,24}PRIVATE KEY[A-Z ]{0,8}-----[\s\S]*?(?:-----END [A-Z ]{0,24}PRIVATE KEY[A-Z ]{0,8}-----|$)/g,
];

/**
 * What a field's name holds, somewhere in it, when its value is never safe to
 * keep, whatever the value looks like.
 *
 * Matched on the name rather than the value because a token has no reliable
 * shape. A field called `authorization` is redacted even if it holds the word
 * "none", which costs nothing and removes the judgement call.
 *
 * Read inside the whole name, lower-cased with its separators removed, so
 * `apikey`, `APIKey`, `accesstoken`, `authToken`, `csrftoken`, `sessionid` and
 * `passwords` are all found: read word by word, they would not be, because a
 * name written as one word has no boundary to split on. What the substring
 * match would take that is not a secret is named below instead, one ordinary
 * name at a time.
 */
const SECRET_IN_A_NAME = [
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'secret',
  'token',
  'credential',
  'cookie',
  'authorization',
  'jwt',
  'signature',
  'bearer',
  'apikey',
  'accesskey',
  'privatekey',
  'sessionid',
  'accountkey',
  'subscriptionkey',
  'privatelines',
  'sessid',
  'sessionkey',
  'signingkey',
  'encryptionkey',
  'masterkey',
  'authkey',
  'passcode',
  'pincode',
  'hmac',
  // A recovery phrase, named wherever it is in a name. A name that ends in
  // `seed`, and a bare `seed=`, are read at the end of a name below; these
  // are the forms that carry more after it.
  'seedphrase',
  'seedwords',
  'recoveryphrase',
  'walletseed',
  'masterseed',
  'mnemonic',
] as const;

/**
 * Names that hold one of those and are not secrets.
 *
 * Matched as substrings alone, `signature` would take the time and key
 * signatures an audio editor lives by, and `token` a tokeniser. Each is named
 * here whole, lower-cased with its separators removed, so the exception is
 * exactly as wide as the name.
 */
const ORDINARY_NAMES: readonly string[] = [
  'timesignature',
  'keysignature',
  'tokeniser',
  'tokenizer',
  'tokencount',
  // The number a generator of noise, identifiers or fixtures starts from,
  // which is what reproduces a fault, and which ends in a word read below.
  'randomseed',
];

/**
 * Words that name a secret on their own, read as words: read as substrings,
 * `auth` would take `author` and `authority`, and `sid` would take `inside`.
 */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  'auth',
  'sid',
  'sig',
  // A one-time code, which is authentication data on its own and holds no word
  // above. `pin`, `seed` and `refresh` are not here: read anywhere in a name
  // they would take `pinPosition`, `randomSeed`, `refreshRate` and
  // `refreshCount`, which are the shape of an audio editor's, a display's and a
  // test's own fields. All three are read at the end of a name instead, and
  // `randomSeed` is named whole among the ordinary names.
  'otp',
]);

/**
 * Words that name a secret where a name ends with them.
 *
 * `db_pass`, `mysql_pass` and `laravel_session` are written this way, and
 * neither word is read anywhere else: `pass` is in no list above, and `session`
 * alone is not one of the words read anywhere in a name. Read anywhere they
 * would take an audio editor's own vocabulary with them, `highPassFilter` and
 * `passBand`, and a count that carries nothing, `sessionCount`.
 *
 * `key` is here for the same reason and with the same care. `licenseKey` and
 * `productKey` end with it, and nothing else reads them; read anywhere in a
 * name it would take the editor's own vocabulary with it, and read as the last
 * word, `keyboard` and `keyCode` end with another and `keySignature` is an
 * ordinary name already. `pin` and `refresh` join it: `userPin` and a bare
 * `refresh` are credentials, and `pinPosition` and `refreshRate` are not.
 * `seed` joins them: a bare `seed=` is how a wallet's recovery phrase is
 * written, and `recoverySeed` and `hdSeed` end with it. Nothing this tree logs
 * is named so, and the rule that holds the logged field names to what is logged
 * says so the day one is.
 *
 * `code` is deliberately absent. It is the most overloaded name a log carries:
 * a command's outcome code is logged on every command that finds nothing to do,
 * and `keyCode`, `outcomeCode` and `sampleRateKey` are the vocabulary this
 * module exists to leave alone. The OAuth authorization code it would be here
 * for is read every way it is really written — `authorization_code` holds
 * `authorization`, `authCode` holds the word `auth`, and one in a query goes
 * with the address it is in. A bare `code=` line is the one shape kept, and the
 * rule that a logged field name survives `namesASecret` is what keeps `code`
 * from being added here by accident. That rule reads a call on a name ending
 * `logger`, at a method the interface offers, with its fields written out in
 * place; a logger held under another name, or fields passed as a variable, is
 * outside it.
 */
const SECRET_AT_THE_END: ReadonlySet<string> = new Set([
  'pass',
  'session',
  'key',
  'pin',
  'refresh',
  'seed',
]);

/**
 * Whether `form` occurs in `joined` anywhere other than wholly inside its
 * first `within` characters, which are an ordinary name's.
 *
 * Wholly, rather than starting inside: `randomseedphrase` begins with the
 * ordinary `randomseed`, and `seedphrase` begins inside it and runs past it.
 * Were it read only after the ordinary name, it would be read nowhere, and a
 * recovery phrase named `randomSeedPhrase` would be kept.
 */
function occursPast(joined: string, form: string, within: number): boolean {
  for (let at = joined.indexOf(form); at !== -1; at = joined.indexOf(form, at + 1)) {
    if (at + form.length > within) return true;
  }
  return false;
}

/**
 * The words of a name after the ordinary name it begins with, where its first
 * words make up that name exactly; all of them where they do not.
 */
function wordsAfter(words: readonly string[], ordinary: string | undefined): readonly string[] {
  if (ordinary === undefined) return words;
  let joined = '';
  for (const [index, word] of words.entries()) {
    joined += word;
    if (joined === ordinary) return words.slice(index + 1);
    if (joined.length >= ordinary.length) break;
  }
  return words;
}

/** Whether a field's name says its value is a secret. */
export function namesASecret(name: string): boolean {
  const joined = name.toLowerCase().replaceAll(NAME_SEPARATORS, '');

  // An ordinary name is matched at the start, so a plural or a longer name
  // built on it, `timeSignatures` or `keySignatureTonic`, is ordinary too; the
  // rest of the name is still read, so `tokenizerSecret` is not, and so is a
  // form that runs on past it, so `randomSeedPhrase` is not.
  const ordinary = ORDINARY_NAMES.find((one) => joined.startsWith(one));
  const within = ordinary?.length ?? 0;
  if (SECRET_IN_A_NAME.some((one) => occursPast(joined, one, within))) return true;

  // The words that make up a leading ordinary name are set aside before the
  // last word is read: `randomSeed` ends in `seed`, and it is `seed` in
  // `randomSeed` rather than a seed of its own.
  const words = wordsAfter(fieldWords(name), ordinary);
  if (words.some((word) => SECRET_WORDS.has(word))) return true;
  return SECRET_AT_THE_END.has(words.at(-1) ?? '');
}

/**
 * A name given a value in text: `name=value`, `name: value`, or either with the
 * name or the value quoted, as JSON writes them.
 *
 * Whether the name is a secret is decided by the rule that reads a field's
 * name, so text and fields agree. Were text to keep a list of its own, it could
 * keep what a field removes: `private_key`, a camelCase name, `clientSecret=`,
 * or a quoted one, `"password":`.
 *
 * A quote can be escaped, once for each time JSON was written inside JSON, and
 * `=>` gives a value as `=` does, so `\\\"password\\\":`, escaped twice, is a
 * name given a value too. A name may start with hyphens, underscores or a
 * dollar sign, as a command-line flag, a framework's own field and a template's
 * variable do: `--password=`, `"_token":` and `$password=` each name a secret.
 * Where in a run a name can begin is {@link NAME_RUN}'s to say, and a name can
 * begin after a dot that itself follows a character no name holds: were it
 * refused there, `users[0].password=hunter2` and `Error:...password=hunter2`
 * would be kept whole, their secrets with them. A name cannot start inside a
 * run, so a long run is read once rather than from each of its characters, a
 * run of backslashes included: were every backslash a start, each would read
 * the whole run before failing. An `=` written as a query writes it inside
 * another's value, `%3D`, gives a value too, so the secret in
 * `client_secret%3Dhunter2` is removed. Where the value ends is
 * {@link valueEnd}'s to say.
 */
const ASSIGNMENT = new RegExp(
  String.raw`${NAME_RUN.notInside}(?<!\\)(\\*["']|)(${NAME_RUN.name})\1\s*(?:=>|[=:]|%3[Dd])\s*`,
  'g',
);

/**
 * A mark that can end a clause, and with it a value written without quotes.
 *
 * It ends one only where {@link endsAClause} says it does. Every mark here can
 * also be a character of a password, and any of them ending a value wherever it
 * stands would keep the rest of it: `--password=Tr0ub4dor&3` would keep `&3`
 * and `Password=ab;cd` would keep `;cd`, against this module's own promise that
 * no part of a secret is left.
 */
const CLAUSE_MARK = /[,;&}\])]/;

/** A character of white space. */
const WHITE_SPACE = /\s/;

/**
 * Whether the clause mark at `at` ends a clause, rather than standing inside a
 * value.
 *
 * A mark that ends a clause has white space, another closing mark or the end of
 * the text after it, or it separates one name given a value from the next, as
 * `&` does between the parameters of a query. A mark inside a password has a
 * character of the password after it: every mark here can be one, and any of
 * them taken to end a value would keep the rest, `--password=Tr0ub4dor&3`
 * keeping `&3`.
 */
function endsAClause(text: string, at: number, assignments: ReadonlySet<number>): boolean {
  const following = text[at + 1];
  if (following === undefined || WHITE_SPACE.test(following) || CLAUSE_MARK.test(following)) {
    return true;
  }
  return assignments.has(at + 1);
}

/**
 * Where a value in quotes that starts at `start` ends, or `undefined` when it
 * does not start with a quote or has no closing one on its line.
 *
 * Opened by an escaped quote, it ends at a quote escaped the same number of
 * times: one backslash for each time JSON was written inside JSON. A longer run
 * is a quote of the value's own text, which carries a backslash for the depth
 * and one more to escape itself. Read as a closing quote, it would end
 * `{\"password\":\"hun\\\"ter2\"}` inside the secret and keep `ter2\"`.
 * Otherwise an escaped character inside it is part of it, and it ends at the
 * first of its quote that ends a word: were it ended at the first quote of any
 * kind, `'O'Brien1'` would keep `Brien1'` and `"ab\"cd"` would keep `cd"`.
 *
 * `unclosed` is where each quote, at each depth, was last found to have no
 * closing one: up to the end of that line, a later value opened by the same
 * quote has none either, since it is read over the same characters. Without it,
 * each value would be read to the end of its line again, and a line of many
 * values that each open a quote and never close it would take seconds.
 *
 * The memo holds one entry per quote and depth, so the depths are bounded
 * ({@link DEEPEST_QUOTE}) and the number of entries with them. Unbounded, a
 * line that opens each of its values one backslash deeper than the last would
 * defeat the memo once per depth and read the whole line again each time, so
 * that 5.2 MB of it would take 13.2 s, growing as the square root of the length
 * times the length rather than with it. The figure is the one the test that
 * holds this case records, which is where it is measured.
 */
function quotedValueEnd(text: string, start: number, unclosed: Unclosed): number | undefined {
  const depth = backslashRunAt(text, start);
  if (depth > DEEPEST_QUOTE) return undefined;
  const quote = text[start + depth];
  if (quote !== '"' && quote !== "'") return undefined;

  const key = `${quote}${String(depth)}`;
  if (start < (unclosed.get(key) ?? -1)) return undefined;

  for (let index = start + depth + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\n') {
      unclosed.set(key, index);
      return undefined;
    }
    if (character === '\\') {
      const run = backslashRunAt(text, index);
      if (depth > 0 && run === depth && text[index + run] === quote) return index + run + 1;
      index += run - 1;
    } else if (depth === 0 && character === quote && !WORD_CHARACTER.test(text[index + 1] ?? '')) {
      return index + 1;
    }
  }
  unclosed.set(key, text.length);
  return undefined;
}

/**
 * The deepest a quote is read as opening a value: one backslash for each time
 * JSON was written inside JSON.
 *
 * Two is what a bundle of a log of a request body reaches, and four is past
 * anything a format this reads produces. Deeper is a quote of the value's own
 * text, which the rule below already refuses, or crafted text: the scan keeps
 * one memo entry per depth, so an unbounded depth is an unbounded number of
 * scans of the same line.
 */
const DEEPEST_QUOTE = 4;

/** Where each quote, keyed by the quote and its depth, was last found to have no closing one. */
type Unclosed = Map<string, number>;

/** How many backslashes in a row start at `at`. */
function backslashRunAt(text: string, at: number): number {
  let end = at;
  while (text[end] === '\\') end += 1;
  return end - at;
}

/**
 * Where the value that starts at `start` ends: after its closing quote, or,
 * without quotes, at the end of its clause or before the next secret's name
 * given a value, at `next`.
 *
 * A value without quotes is not one word: were it ended at the first space,
 * `passphrase: correct horse battery staple` would keep three words of four.
 * Taking the rest of the clause is the cost of never keeping a part of a
 * secret, the trade the path rules make. A mark ends the clause only where
 * {@link endsAClause} says it does: were it taken as the end, a mark standing
 * inside the value, as `&` does in `Tr0ub4dor&3`, would leave the rest of it.
 */
function valueEnd(
  text: string,
  start: number,
  next: number,
  assignments: ReadonlySet<number>,
  unclosed: Unclosed,
): number {
  const quoted = quotedValueEnd(text, start, unclosed);
  if (quoted !== undefined) return quoted;

  let end = start;
  while (end < text.length && end < next) {
    const character = text[end] ?? '';
    if (character === '\n') break;
    if (CLAUSE_MARK.test(character) && endsAClause(text, end, assignments)) break;
    end += 1;
  }
  while (end > start && WHITE_SPACE.test(text[end - 1] ?? '')) end -= 1;
  return end;
}

/**
 * The credentials in an address, `scheme://user:password@`, to the `@`, with
 * the scheme in the first group.
 *
 * The scheme is read from the start of its run, as an assignment's name is:
 * were it read from anywhere else,
 * `Retrying (2/3)...postgres://admin:hunter2@host/app` would be kept whole.
 * Where no scheme can be read, `1234://admin:hunter2@host`, the credentials are
 * found all the same, from the `://`: they are the secret whatever is written
 * before them. The user part cannot hold the colon that ends it: were it able
 * to, a run of colons after a scheme would be split every way before the match
 * failed.
 */
const ADDRESS_CREDENTIALS = new RegExp(
  String.raw`(?:${SCHEME_RUN.notInside}(${SCHEME_RUN.name}))?:\/\/[^\s/@:]+:[^\s/@]+@`,
  'g',
);

/**
 * A text with each address that carries credentials removed whole, from its
 * scheme to where the address ends ({@link addressEnd}).
 *
 * Were it ended at its first space, an address on a share would leave the rest
 * of its path standing: `sftp://jane:pw@nas/Clients/Jane Smith/Private` would
 * keep ` Smith/Private`, and the path rules, which read across a space, would
 * never see it.
 */
function withoutAddressCredentials(text: string, removed: () => string): string {
  let result = '';
  let from = 0;
  // Read once, on the first address that ends where a path ends, and searched
  // after that. Built per address, a text of many share addresses would read
  // the whole of it once for each.
  let quotes: QuoteIndex | undefined;

  for (const found of text.matchAll(ADDRESS_CREDENTIALS)) {
    if (found.index < from) continue;
    result += text.slice(from, found.index) + removed();
    quotes ??= indexQuotes(text);
    from = addressEnd(text, found.index, found.index + found[0].length, found[1], quotes);
  }
  return result + text.slice(from);
}

/**
 * Credentials embedded in text.
 *
 * Covers the shapes that actually appear in error messages besides an
 * assignment and an address: a bearer or basic credential, and a header that
 * carries one. `Basic` stands beside `Bearer` because a failed `fetch` and a
 * pasted `curl -v` transcript both print the line without its header name,
 * where the header rule below cannot reach it.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  // A header carrying a credential, to the end of its line. Read before the
  // credential itself: the header takes a scheme and its value, so with the
  // value already a placeholder it would read the placeholder as the scheme and
  // take the next word of the sentence as the value, and
  // `Authorization: Basic ... sent` would lose its `sent`.
  /\b(?:set-)?cookie:[^\n]*/gi,
  /\bauthorization:\s*\S+(?:[ \t]+\S+)?/gi,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
];

/**
 * A text with each value given to a secret's name removed, name and all.
 *
 * The value is read ahead rather than matched, so a name that is not a secret
 * takes nothing with it: `refused: access_token=…` is `refused:` and then an
 * assignment of its own.
 */
function withoutAssignedSecrets(text: string, removed: () => string): string {
  const assignments = [...text.matchAll(ASSIGNMENT)];

  // Where each secret's name given a value after white space starts, which ends
  // a value without quotes before it. Only another secret's name, strictly
  // after the value's start, ends one: were any name to, one at the value's own
  // start, `token: dGVzdA==` read as `dGVzdA=`, would leave the whole value.
  // Walked by one pointer that only moves forward, so the text is read once
  // however many values it holds.
  const boundaries = assignments
    .filter(
      (assignment) =>
        WHITE_SPACE.test(text[assignment.index - 1] ?? '') && namesASecret(assignment[2] ?? ''),
    )
    .map((assignment) => assignment.index);
  let following = 0;

  // Where a name given a value starts, whether or not it names a secret: a
  // clause mark with one straight after it separates two of them, as `&` does
  // between the parameters of a query.
  const starts = new Set(assignments.map((assignment) => assignment.index));
  const unclosed: Unclosed = new Map();

  let result = '';
  let from = 0;
  for (const assignment of assignments) {
    const [written, , name = ''] = assignment;
    if (assignment.index < from || !namesASecret(name)) continue;

    const start = assignment.index + written.length;
    while ((boundaries[following] ?? text.length) <= start) following += 1;

    result += text.slice(from, assignment.index) + removed();
    from = valueEnd(text, start, boundaries[following] ?? text.length, starts, unclosed);
  }
  return result + text.slice(from);
}

/** Replaces every match of each pattern with what `removed` gives. */
function replacing(text: string, patterns: readonly RegExp[], removed: () => string): string {
  return patterns.reduce((result, pattern) => result.replace(pattern, removed), text);
}

/**
 * A text with every credential it holds removed, and nothing else. `removed`
 * is what each is replaced with, and counts it.
 */
export function withoutCredentials(text: string, removed: () => string): string {
  // The addresses, the headers and the bearer form first: each carries a scheme
  // before its secret, and read as an assignment, `Authorization: Basic …`
  // would lose only the scheme.
  const labelled = replacing(
    withoutAddressCredentials(text, removed),
    CREDENTIAL_PATTERNS,
    removed,
  );
  const assigned = withoutAssignedSecrets(labelled, removed);
  return replacing(assigned, CREDENTIAL_SHAPES, removed);
}
