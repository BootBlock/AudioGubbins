/**
 * Removing sensitive content before a diagnostic leaves the machine.
 *
 * REQ-PRIV-161 lists what a diagnostic bundle must exclude by default:
 * credentials, access tokens, API keys, cookies, authentication data, full
 * local filesystem paths, and source filenames where they may reveal something
 * sensitive. REQ-PRIV-165 adds that local paths and filenames are sanitised in
 * a shareable bundle unless the user deliberately chooses to include them.
 *
 * Redaction here is a safety net, not the primary control. The primary control
 * is that {@link LogFieldValue} cannot hold audio, a project or an arbitrary
 * object in the first place. This catches the remaining case: a string that
 * happens to contain a path, a file name, a token or a whole file.
 *
 * Every string a record carries is redacted, not only its message and fields. A
 * category, an operation identifier and a measurement's name are written by
 * code, and code can build one from a value: an operation identified by the
 * file it imports is a file name in the one field nobody thought to check.
 *
 * Every rule replaces rather than deletes. A record that still says a path was
 * present is diagnostically useful; one where the field vanished is confusing.
 */

import { namesASecret, withoutCredentials } from './credentials.js';
import type { LogFieldValue, LogFields, LogRecord, SanitisedStackTrace } from './log-record.js';
import {
  namesAFile,
  SEPARATOR,
  SERVED_FILE_KINDS,
  WEB_SCHEMES,
  absolutePathsIn,
  lastSeparatorIn,
  userFileNamesIn,
} from './path-finding.js';
import { SCHEME_RUN, fieldWords } from './text-runs.js';

/** What a redaction replaced. */
export const RedactionReason = {
  AbsolutePath: 'absolute-path',
  FileName: 'file-name',
  Credential: 'credential',
  Url: 'url',
  EmbeddedData: 'embedded-data',
  EmailAddress: 'email-address',
  NetworkAddress: 'network-address',
} as const;

/** What a redaction replaced. */
export type RedactionReason = (typeof RedactionReason)[keyof typeof RedactionReason];

/** Replacement text, chosen so a reader can see that something was removed. */
const PLACEHOLDER: Record<RedactionReason, string> = {
  [RedactionReason.AbsolutePath]: '<path>',
  [RedactionReason.FileName]: '<file>',
  [RedactionReason.Credential]: '<redacted>',
  [RedactionReason.Url]: '<url>',
  [RedactionReason.EmbeddedData]: '<data>',
  [RedactionReason.EmailAddress]: '<email>',
  [RedactionReason.NetworkAddress]: '<address>',
};

/*
 * Every global pattern below is used through `String.replace`, which resets a
 * global pattern's position before it starts and leaves it reset when it
 * finishes, and every other is not global, so `test` keeps no position in it.
 * The patterns are therefore safe to share between calls, and are built once
 * rather than on every record.
 */

/**
 * The last word of a field name that says its value is a location.
 *
 * A value in such a field is treated as a path whatever it looks like, because
 * a relative path or a bare name has no shape a pattern can rely on and the
 * field name has already said what it is. Compared by word, so `profile` is not
 * a `file` and `pathway` is not a `path`.
 */
const LOCATION_WORDS: ReadonlySet<string> = new Set([
  'path',
  'file',
  'filename',
  'filepath',
  'pathname',
  'folder',
  'directory',
  'dir',
  'dirname',
  'location',
]);

/** A word before `name` that makes the field a location: `fileName`, `folderName`. */
const NAMED_LOCATIONS: ReadonlySet<string> = new Set(['file', 'folder', 'dir', 'directory']);

/**
 * A field whose value is the machine at the other end, or this one.
 *
 * A host name has no shape a text pattern can find — `nas.local`, `JANES-PC`
 * and `studio-imac` are words — so it is found by the field that holds it and
 * replaced whole. Without that, a machine name reached through a path would be
 * removed and the same machine named in a field would not.
 */
const HOST_WORDS: ReadonlySet<string> = new Set([
  'host',
  'hostname',
  'ip',
  'address',
  'server',
  'machine',
  'peer',
  'origin',
]);

/**
 * A network address written in a text: four decimal octets, or an IPv6
 * literal.
 *
 * REQ-PRIV-161 leaves a local path out of a report because its leading
 * segments identify the person and their machine. An address does the same
 * thing by another route: `10.0.0.42` says which network, and a link-local
 * IPv6 address carries the network card's own identifier.
 *
 * Each octet is held to 0-255 and the run is refused after a letter, a slash
 * or a dot, so a version written as part of a word is not an address:
 * `Chrome/141.0.0.0` is four numbers in range, and a user agent is full of
 * them. A bare four-part version standing on its own cannot be told from an
 * address and is removed; the versions a report carries are three-part and are
 * written into fields of their own rather than into a message, so this costs a
 * reader nothing that was measured.
 *
 * An IPv6 literal is read only where it holds `::`, or where it is all eight
 * groups: two or three groups of hexadecimal digits with colons between them
 * is what a time of day looks like.
 */
const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const HEXTET = String.raw`[0-9a-f]{1,4}`;
const NETWORK_ADDRESS = new RegExp(
  [
    String.raw`(?<![\w/.-])${OCTET}(?:\.${OCTET}){3}(?![\w.-])(?::\d{1,5})?`,
    String.raw`(?<![\w:])(?:${HEXTET}:){7}${HEXTET}(?![\w:])`,
    String.raw`(?<![\w:])(?:${HEXTET}(?::${HEXTET})*)?::(?:${HEXTET}(?::${HEXTET})*)?(?![\w:])`,
  ].join('|'),
  'gi',
);

/**
 * A whole file carried inline.
 *
 * A `data:` address holds its content rather than pointing at it, so it can be
 * an entire recording or document: REQ-PRIV-165 forbids encoded audio payloads
 * and full file contents in a log, which this is. Removed before anything else
 * reads the text, because its base64 body can contain what looks like a path.
 *
 * A parameter cannot hold the semicolon that starts the next one. Were it able
 * to, a run of semicolons with no comma after it would be split every way
 * before the match failed: forty of them would not finish in five minutes.
 *
 * The body runs to the end of its line, or to a quote or a bracket that marks
 * it off, rather than to the first space. A body has no spaces in it once it is
 * written properly, and ended at the first space, a body written with them
 * would keep all but its first word: `data:text/plain,Jane Smith notes` would
 * leave ` Smith notes` standing. Losing the rest of a line is the cost of never
 * keeping a part of a file.
 */
const EMBEDDED_DATA_PATTERN = /\bdata:(?:[\w.+-]+\/[\w.+-]+)?(?:;[^\s,;"'<>]*)*,[^\n"'<>]*/gi;

/** How a web address or an object's starts, under the schemes the path rules leave. */
const ADDRESS_START = String.raw`(?:(?:${WEB_SCHEMES}):\/\/|blob:)`;

/**
 * A web address, or an object's, which says where a person is or what they
 * opened.
 *
 * A `blob:` address names the page's own origin and an object the user loaded,
 * and is removed on the same terms as a web address. An address under another
 * scheme, `smb://` or `sftp://`, is a path on a share, and the path rules
 * remove it (see `path-finding.ts`). None starts inside a run of a scheme's
 * characters, so a long dotted run is read once rather than from each dot;
 * where in a run a scheme can begin is {@link SCHEME_RUN}'s to say, and were a
 * scheme after a dot refused, `Error: ...https://x/users/jane.smith` would be
 * kept whole.
 */
const URL_PATTERN = new RegExp(
  String.raw`${SCHEME_RUN.notInside}${SCHEME_RUN.leading}${ADDRESS_START}\S+`,
  'gi',
);

/** A value that is a web address or an object's, whatever field it is in. */
const WEB_ADDRESS = new RegExp(String.raw`^\s*${ADDRESS_START}`, 'i');

/** A value that is inline data, whatever field it is in. */
const INLINE_DATA = /^\s*data:/i;

/**
 * An e-mail address, which names a person as surely as an account folder does.
 *
 * In any script, and with a port after it; not a Gecko stack frame with no
 * address, `onImport@codec.ts:12:3`, which names a file AudioGubbins is served
 * as, with its line and column after it. Were any address before a line and
 * column taken for a frame, `JANE@EXAMPLE.COM:1:2` would be kept. Read after
 * the paths and the names, so a path through an account named for an address is
 * removed whole. None starts inside a run of its own characters.
 */
const EMAIL_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?!\.?[\p{L}\p{N}-])(?!(?<=\.(?:${SERVED_FILE_KINDS}))(?::\d+){2})`,
  'giu',
);

/** The query string and the fragment of an address, which can carry a token. */
const QUERY_AND_FRAGMENT = /[?#].*$/;

/**
 * The query after a location that is not an address. Not the fragment: `#` is a
 * character a folder or a file's name can hold, and read as one,
 * `Jane Smith #2` would become the kept name.
 */
const QUERY = /\?.*$/;

/** Whether a path is written as an address, `sftp://host/a`, and so has a query. */
const SCHEME_AT_THE_START = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** A location with its query and its fragment taken off, before its last segment is read. */
function withoutTheQuery(location: string): string {
  return location.replace(QUERY_AND_FRAGMENT, '');
}

/** What happened during a redaction pass. */
export interface RedactionSummary {
  /** How many replacements were made, by reason. */
  readonly counts: Readonly<Record<RedactionReason, number>>;
}

/** Options controlling how much detail survives redaction. */
export interface RedactionOptions {
  /**
   * Whether to keep the name of a file, dropping only the folders around it.
   *
   * Off by default. REQ-PRIV-161 excludes source filenames where they may
   * reveal something sensitive, and AudioGubbins cannot tell which those are.
   * The user may turn it on when they judge the filenames safe and useful.
   */
  readonly keepFileNames?: boolean;
}

/** Counts every reason at zero. */
function emptyCounts(): Record<RedactionReason, number> {
  return {
    [RedactionReason.AbsolutePath]: 0,
    [RedactionReason.FileName]: 0,
    [RedactionReason.Credential]: 0,
    [RedactionReason.Url]: 0,
    [RedactionReason.EmbeddedData]: 0,
    [RedactionReason.EmailAddress]: 0,
    [RedactionReason.NetworkAddress]: 0,
  };
}

/** Replaces every match, counting the replacements. */
function replaceAll(
  text: string,
  patterns: readonly RegExp[],
  reason: RedactionReason,
  counts: Record<RedactionReason, number>,
  replacement: (match: string) => string = () => PLACEHOLDER[reason],
): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, (match) => {
      counts[reason] += 1;
      return replacement(match);
    });
  }
  return result;
}

/** What a credential is replaced with, counted as it is. */
function credentialRemoved(counts: Record<RedactionReason, number>): () => string {
  return () => {
    counts[RedactionReason.Credential] += 1;
    return PLACEHOLDER[RedactionReason.Credential];
  };
}

/** The final segment of a path, or the whole text when it has no separator. */
function finalSegment(path: string): string {
  return path.slice(lastSeparatorIn(path, 0, path.length) + 1);
}

/**
 * What a location is replaced with.
 *
 * The folders always go. The file name stays only when the user asked for it,
 * and then after the placeholder, so a reader can still see a path was there,
 * and only where the segment names a file ({@link namesAFile}).
 */
function redactedLocation(
  location: string,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions,
): string {
  if (!SEPARATOR.test(location)) {
    // The end of the file-name rules: this text was found to be one name, or is
    // a whole location field with no folders in it. A credential or an e-mail
    // address written where a name was expected is not a name, and goes as what
    // it is, so a reader sees what was removed rather than being told a field
    // holding an address was a file.
    const cleaned = replaceAll(
      withoutCredentials(location, credentialRemoved(counts)),
      [EMAIL_PATTERN],
      RedactionReason.EmailAddress,
      counts,
    );
    if (cleaned !== location) return cleaned;
    if (options.keepFileNames === true && namesAFile(location)) return location;

    counts[RedactionReason.FileName] += 1;
    return PLACEHOLDER[RedactionReason.FileName];
  }

  counts[RedactionReason.AbsolutePath] += 1;
  if (options.keepFileNames !== true) return PLACEHOLDER[RedactionReason.AbsolutePath];

  // The name the user chose to keep can still hold a credential, so it goes
  // through the text rules on its own.
  const name = keptSegment(location, counts, options);
  return name === ''
    ? PLACEHOLDER[RedactionReason.AbsolutePath]
    : `${PLACEHOLDER[RedactionReason.AbsolutePath]}/${name}`;
}

/**
 * The last segment of `location`, where that segment names a file, and the
 * empty text where it does not.
 *
 * A segment that names no file is not a name to keep: kept as though it were
 * one, an account folder, `C:\Users\Jane Smith`, would stay, and the authority
 * of an address with no path, `https://admin:hunter2@host:8080`, would carry
 * its credentials with it.
 */
function keptSegment(
  location: string,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions,
): string {
  const segment = finalSegment(location);
  return namesAFile(segment) ? redactText(segment, counts, options) : '';
}

/**
 * What a piece of free text will carry once it is redacted, and how many
 * parts of it were removed.
 *
 * For showing a reader what a report will hold before they agree to it
 * (REQ-PRIV-161). The redaction the bundle applies is the one asked here, so a
 * preview cannot differ from what is saved. The tally is the reader's own: the
 * one the report carries is counted while the report is built, so a preview
 * cannot add to it.
 *
 * Both answers, because a reader needs each in a different place. The text
 * exists because the rules cannot lean on structure in prose a person wrote:
 * the walk back from a file's extension takes every word before it, which is
 * what keeps a person's name from being left standing, and it means a whole
 * sentence can become one placeholder. Told only that one file name went, a
 * reader has no way to know their account of the fault went with it. The
 * count exists because the text is as long as the note, up to four thousand
 * characters, and a bounded sentence is what can be read out.
 */
export function previewRedaction(
  text: string,
  options: RedactionOptions = {},
): { readonly text: string; readonly removed: number } {
  const counts = emptyCounts();
  const redacted = redactText(text, counts, options);
  return {
    text: redacted,
    removed: Object.values(counts).reduce((total, one) => total + one, 0),
  };
}

/**
 * Removes sensitive content from a string.
 *
 * The order matters. Inline data goes first, because its body can look like
 * anything; credentials before addresses and paths, because a URL holding
 * basic-auth credentials would otherwise have them survive inside what the
 * address rule left behind; absolute paths before file names, so a path is
 * removed whole rather than having its last segment removed on its own.
 */
export function redactText(
  text: string,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions = {},
): string {
  // An address or a path loses everything before its last segment, and keeps
  // that segment only when the user asked for file names. A stack frame served
  // from the application's own address is then still `index-1a2b.js:3:14`,
  // which is the part a source map needs.
  //
  // An address's query and fragment go with its folders, before its last
  // segment is read. Were they left on, a name kept on the user's instruction
  // would carry `?access_token=` after it, and were they read after the
  // segment, a slash in the query would make the query's tail the kept name. A
  // path written as an address reads the same way, or
  // `sftp://host/a/take.wav?next=/home/jane.smith` would keep the account
  // folder out of the query. A plain path keeps its query, since `?` is a
  // character a name can hold where there is no drive letter.
  const keepingName = (reason: RedactionReason, everyAddress: boolean) =>
    options.keepFileNames === true
      ? (match: string) => {
          const read =
            everyAddress || SCHEME_AT_THE_START.test(match) ? withoutTheQuery(match) : match;
          const segment = finalSegment(read);
          const name = namesAFile(segment) ? segment : '';
          return name === '' ? PLACEHOLDER[reason] : `${PLACEHOLDER[reason]}/${name}`;
        }
      : undefined;

  let result = replaceAll(text, [EMBEDDED_DATA_PATTERN], RedactionReason.EmbeddedData, counts);
  result = withoutCredentials(result, credentialRemoved(counts));
  result = replaceAll(
    result,
    [URL_PATTERN],
    RedactionReason.Url,
    counts,
    keepingName(RedactionReason.Url, true),
  );
  result = redactPaths(result, counts, keepingName(RedactionReason.AbsolutePath, false));
  result = redactFileNames(result, counts, options);
  result = replaceAll(result, [EMAIL_PATTERN], RedactionReason.EmailAddress, counts);
  // Last, so an address inside a web address or a path has already gone with
  // it, and a dotted quad is not read out of an e-mail's domain.
  return replaceAll(result, [NETWORK_ADDRESS], RedactionReason.NetworkAddress, counts);
}

/**
 * Replaces every user file's name found without an absolute path, from where
 * `path-finding.ts` says it starts.
 */
function redactFileNames(
  text: string,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions,
): string {
  // A name kept on the user's instruction follows its path's or its address's
  // placeholder, and is the one name here that is not removed.
  const kept =
    options.keepFileNames === true
      ? [PLACEHOLDER[RedactionReason.AbsolutePath], PLACEHOLDER[RedactionReason.Url]]
      : [];

  let result = '';
  let from = 0;
  for (const { start, end } of userFileNamesIn(text, kept)) {
    result += text.slice(from, start) + redactedLocation(text.slice(start, end), counts, options);
    from = end;
  }
  return result + text.slice(from);
}

/**
 * Replaces every absolute path, each from its root to where `path-finding.ts`
 * says it stops.
 *
 * The leading segments are what identify a person: a user name, a machine name,
 * a share name. The final segment is kept only when the caller asks for it,
 * because a file name can itself be sensitive (REQ-PRIV-161).
 */
function redactPaths(
  text: string,
  counts: Record<RedactionReason, number>,
  keepName: ((match: string) => string) | undefined,
): string {
  let result = '';
  let copied = 0;

  for (const { start, end } of absolutePathsIn(text)) {
    const path = text.slice(start, end);
    counts[RedactionReason.AbsolutePath] += 1;
    result +=
      text.slice(copied, start) +
      (keepName === undefined ? PLACEHOLDER[RedactionReason.AbsolutePath] : keepName(path));
    copied = end;
  }

  return result + text.slice(copied);
}

/** Whether a field's name says that its value is a location. */
function namesALocation(name: string): boolean {
  const words = fieldWords(name);
  const last = words.at(-1) ?? '';
  const beforeLast = words.at(-2) ?? '';
  return LOCATION_WORDS.has(last) || (NAMED_LOCATIONS.has(beforeLast) && last === 'name');
}

/** Whether a field's name says that its value is a machine or its address. */
function namesAHost(name: string): boolean {
  const words = fieldWords(name);
  const last = words.at(-1) ?? '';
  return HOST_WORDS.has(last) || (HOST_WORDS.has(words.at(-2) ?? '') && last === 'name');
}

/** Removes sensitive content from one structured field value. */
function redactValue(
  name: string,
  value: LogFieldValue,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions,
): LogFieldValue {
  if (namesASecret(name)) {
    counts[RedactionReason.Credential] += 1;
    return PLACEHOLDER[RedactionReason.Credential];
  }
  if (typeof value !== 'string') return value;
  if (value !== '' && namesAHost(name)) {
    counts[RedactionReason.NetworkAddress] += 1;
    return PLACEHOLDER[RedactionReason.NetworkAddress];
  }
  if (value === '' || !namesALocation(name)) return redactText(value, counts, options);
  return redactedLocationField(value, counts, options);
}

/**
 * What a location field's value is replaced with.
 *
 * The whole value is a location, whatever it looks like, so it is replaced
 * whole: a name with spaces in it has no edge a text pattern could find. Inline
 * data goes whole, as its last segment is its body. A web address loses its
 * query and fragment and its folders, and keeps its last segment only on the
 * user's instruction. Sent through the text rules, an address with a space in
 * it would keep what came after the space, and inline data its body's tail.
 */
function redactedLocationField(
  value: string,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions,
): string {
  if (INLINE_DATA.test(value)) {
    counts[RedactionReason.EmbeddedData] += 1;
    return PLACEHOLDER[RedactionReason.EmbeddedData];
  }

  if (WEB_ADDRESS.test(value)) {
    counts[RedactionReason.Url] += 1;
    if (options.keepFileNames !== true) return PLACEHOLDER[RedactionReason.Url];
    const name = keptSegment(withoutTheQuery(value.trim()), counts, options);
    return name === ''
      ? PLACEHOLDER[RedactionReason.Url]
      : `${PLACEHOLDER[RedactionReason.Url]}/${name}`;
  }

  // A path or a name. A query can follow a name, `take.wav?access_token=…`,
  // and goes with the folders.
  return redactedLocation(value.replace(QUERY, ''), counts, options);
}

/** Removes sensitive content from a set of structured fields. */
export function redactFields(
  fields: LogFields,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions = {},
): LogFields {
  const redacted: Record<string, LogFieldValue> = {};
  for (const [name, value] of Object.entries(fields)) {
    // The name is redacted as well as the value. Every field name in this build
    // is a literal, so this is a safety net rather than a fix: a name built
    // from a value is exactly how a category can come to carry a path, which is
    // what the record-level redaction is for.
    //
    // Two names can become one placeholder, `a.wav` and `b.wav` both `<file>`,
    // and plain assignment would keep the second and drop the first, so the
    // record the user inspects before consenting would show one field where
    // there were two. Each keeps a place of its own.
    const base = redactText(name, counts, options);
    let key = base;
    for (let copy = 2; Object.hasOwn(redacted, key); copy += 1) key = `${base}#${String(copy)}`;
    redacted[key] = redactValue(name, value, counts, options);
  }
  return redacted;
}

/** Removes absolute paths from a stack trace, keeping the frame structure. */
export function redactStack(
  stack: SanitisedStackTrace,
  counts: Record<RedactionReason, number>,
  options: RedactionOptions = {},
): SanitisedStackTrace {
  return { frames: stack.frames.map((frame) => redactText(frame, counts, options)) };
}

/**
 * One line of a stack trace, in the forms the engines write.
 *
 * Chromium writes `    at name (location)`, and Gecko and WebKit write
 * `name@location:line:column`. Anything else in the text is the error's
 * message, which can hold whatever the failing code put in it and is not a
 * frame.
 */
const STACK_FRAME = /^\s*at\s|@.*:\d+:\d+$/;

/**
 * Turns an engine's stack text into a trace fit to keep in the log.
 *
 * The one producer of {@link SanitisedStackTrace}, so the type's name is a
 * promise something keeps: the message lines are dropped, because the message
 * is logged as a field on its own terms, and every frame loses its folders and
 * keeps its file name, line and column, which is what makes a frame worth
 * having. A bundle redacts the frames again on the user's terms when it is
 * assembled.
 */
export function sanitiseStack(stack: string | undefined): SanitisedStackTrace | undefined {
  if (stack === undefined) return undefined;

  const counts = emptyCounts();
  const frames = stack
    .split('\n')
    .filter((line) => STACK_FRAME.test(line))
    .map((line) => redactText(line.trim(), counts, { keepFileNames: true }));

  return frames.length === 0 ? undefined : { frames };
}

/**
 * Redacts a batch of records, reporting what was removed.
 *
 * The summary travels in the bundle, where whoever opens the report reads it.
 * It is not what the dialogue shows before the reader agrees: REQ-PRIV-161's
 * mandatory clause is answered by the list of categories and the preview of
 * the reader's own note, both of which are built without redacting anything.
 * Counting the removals means redacting every record, which the dialogue would
 * have to do on each keystroke, and this file is the one whose cost a reader's
 * paste multiplies. A phase that adds submission has to show the counts before
 * the bundle leaves the machine, and will need a cheaper count than this one.
 */
export function redactRecords(
  records: readonly LogRecord[],
  options: RedactionOptions = {},
): { readonly records: readonly LogRecord[]; readonly summary: RedactionSummary } {
  const counts = emptyCounts();

  const redacted = records.map((record): LogRecord => {
    const stack =
      record.stack === undefined ? undefined : redactStack(record.stack, counts, options);
    return {
      timestamp: record.timestamp,
      severity: record.severity,
      category: redactText(record.category, counts, options),
      message: redactText(record.message, counts, options),
      fields: redactFields(record.fields, counts, options),
      ...(record.correlationId === undefined
        ? {}
        : { correlationId: redactText(record.correlationId, counts, options) }),
      ...(stack === undefined ? {} : { stack }),
    };
  });

  return { records: redacted, summary: { counts } };
}
