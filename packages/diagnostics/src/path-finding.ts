/**
 * Finding a filesystem path, or a file's name, in text: where each starts and
 * where it ends.
 *
 * The part of redaction that cannot be a pattern. A path's start has a shape, a
 * drive, a share or a root; its end does not, because a folder or a file name
 * can hold spaces and apostrophes and a sentence goes on after it. A file's
 * name without a path has only its end, its extension, and is read back from
 * there. The rules that decide where each starts and ends are here, apart from
 * what redaction does with it once it is found. What a run of name characters
 * is, which these rules and the credential rules both have to agree on, is in
 * `text-runs.ts`.
 */

import { SCHEME_RUN, WORD_CHARACTER } from './text-runs.js';

/** A character a path's folder or file name can hold, apostrophes included. */
const SEGMENT = String.raw`[^\s"<>|\\/]`;

/**
 * The first segment of a path relative to a drive, `C:Users\Jane Smith`.
 *
 * A {@link SEGMENT} with no colon in it, bounded to the longest name Windows
 * allows. Written as `SEGMENT+`, the lookahead that reads this form would run
 * to the end of the line at every `letter:` and backtrack over it, because a
 * colon is a segment character: a line of `a:` pairs would be read once per
 * pair, and 800 kB of them would take nearly two minutes. No Windows segment
 * may hold a colon, so excluding it costs nothing and ends the scan at the
 * first one.
 */
const FIRST_SEGMENT = String.raw`[^\s"<>|\\/:]{1,255}`;

/**
 * The schemes of a web address, which the address rules remove rather than the
 * path rules.
 */
export const WEB_SCHEMES = String.raw`https?|wss?|ftps?`;

/**
 * Every scheme the path rules leave to another rule: a web address, an object
 * the page holds (`blob:`) and inline content (`data:`), each removed whole by
 * a rule of its own in `redaction.ts`.
 *
 * The one list of them, which the root below reads.
 */
const SCHEMES_NOT_A_PATH = String.raw`${WEB_SCHEMES}|blob|data`;

/**
 * The schemes whose address ends at the first white space.
 *
 * Not every scheme the address rules take: a file-transfer address holds a path
 * with spaces in it exactly as a share's does, so `ftp://` and `ftps://` end
 * where a path ends. Ended at a space,
 * `ftp://jane:pw@host/Clients/Jane Smith/Private` would leave ` Smith/Private`
 * after the placeholder, which is the surname and the folder.
 */
const ENDS_AT_WHITE_SPACE = String.raw`https?|wss?`;

/** A scheme, read with its run from where it starts, whose address ends at white space. */
const WEB_SCHEME = new RegExp(String.raw`^${SCHEME_RUN.leading}(?:${ENDS_AT_WHITE_SPACE})$`, 'i');

/**
 * The letters and digits of a word, written for a character class, which a root
 * cannot follow. Not the underscore: code writes a prefix to a value with one,
 * `cache_/home/jane` and `log_C:\Users\jane`, and a root refused after it would
 * keep the path whole.
 */
const LETTERS_AND_DIGITS = 'A-Za-z0-9';

/**
 * Where a home directory starts: a tilde, with or without the name of whose
 * home it is, or the variable a shell or the command interpreter writes it as.
 *
 * Each is a whole local path once it is expanded, which REQ-PRIV-161 leaves out
 * of a report, and each is the form a shell error, a failed `open` and a
 * traceback print. The form that names the person, `~jane/Music`, is read as
 * surely as `~/Music`, which names nobody.
 *
 * A name after the tilde starts with a letter, since `~` before a number is
 * how a count is written as approximate: `~50/60 frames` is not a path.
 */
const HOME_ROOT = String.raw`~(?:[A-Za-z][${LETTERS_AND_DIGITS}._-]*)?(?=[\\/])|\$\{?HOME\}?(?=[\\/])|%(?:USERPROFILE|HOMEPATH|HOMEDRIVE|APPDATA|LOCALAPPDATA)%(?=[\\/])`;

/**
 * Where an absolute path starts: a `file:` address, a Windows drive, a UNC
 * share, or a POSIX root.
 *
 * Only the start is matched here; where the path ends is decided by
 * {@link pathEnd}, because no pattern could tell
 * `C:\Users\Alex Bloggs\Jane Smith Interview` from
 * `C:\Users\alex\take.wav crashed it`.
 *
 * A `file:` address is a path written as a URL, and ends by the same rules: a
 * pattern of its own would stop at an apostrophe and at a space, which a
 * browser leaves unescaped in a path it prints.
 *
 * A POSIX root counts only with a folder after it, of any name: a list of roots
 * would leave /media/jane/USB, /run/media/jane, /Volumes/Jane and
 * /data/data/com.audiogubbins whole, and those are the mount points of the
 * removable drives an audio editor imports from. The lookbehind refuses a slash
 * inside a word, so `and/or`, `50/50`, `1/2` and a date are left alone. A quote
 * before the slash is not refused: a path in single quotes is how Node and most
 * error messages print one, and refusing it would let the whole path through.
 *
 * Two more roots name a machine or an account as surely: a share written with
 * forward slashes, `//JANES-PC/Users/jane` or `//JANES-PC` alone, and a path
 * starting from the folder it was in, `../../home/jane`, `..\..\Users\jane` or
 * `./home/jane`, the dots with it, so no placeholder is left after the dots. A
 * protocol-relative address has the share's shape and goes with it, which costs
 * a reader nothing a path would not.
 *
 * A drive letter starts a word: `http://` with nothing after it is not an
 * address, and its `p:/` is not a drive. A dot before it does not stop it, so a
 * path written straight after an ellipsis, `Saving...C:\Users\jane`, is found.
 * A scheme reads the same way, from the start of its run ({@link SCHEME_RUN}),
 * so `Retrying (2/3)...sftp://host/take.wav` is found after the dots. No root
 * is refused after an underscore ({@link LETTERS_AND_DIGITS}). A backslash pair
 * before a quote is an escape, in JSON written inside JSON, and not a share:
 * read as one, it would wrap each quoted word of such a text in placeholders.
 *
 * An address under any scheme the address rules do not take
 * ({@link SCHEMES_NOT_A_PATH}) is a path on a share, `smb://`, `afp://`,
 * `nfs://`, `sftp://`, and ends as a path ends: read as an address, it would
 * end at its first space, and leave `Jane Smith/Private` after it.
 *
 * A home directory is a root of its own ({@link HOME_ROOT}), and so is a drive
 * with no separator after it, `C:Users\Jane Smith`, which is a path relative
 * to that drive's current folder. That form is read only where a backslash
 * follows the first segment ({@link FIRST_SEGMENT}): a letter, a colon and a
 * segment is also how a ratio and a label are written, and `A:B/C` is not a
 * path.
 */
const PATH_ROOT = new RegExp(
  String.raw`\bfile:\/\/|${SCHEME_RUN.notInside}${SCHEME_RUN.leading}(?!(?:${SCHEMES_NOT_A_PATH}):)[a-z][a-z0-9+.-]+:\/\/|${HOME_ROOT}|(?<![${LETTERS_AND_DIGITS}+-])[A-Za-z]:(?:[\\/]|(?=${FIRST_SEGMENT}\\))|\\\\(?=[^\s\\"'])|(?<![:${LETTERS_AND_DIGITS}\\/])\/\/(?=[A-Za-z0-9][\w.-]*(?:\/|(?![\w.-])))|(?<![${LETTERS_AND_DIGITS}.\\/-])\.\.?[\\/](?=${SEGMENT}+(?: ${SEGMENT}+)*[\\/])|(?<![${LETTERS_AND_DIGITS}.\\/-])\/(?=${SEGMENT}+(?: ${SEGMENT}+)*\/)`,
  'gi',
);

/** A character that cannot be part of a path written without quotes. */
const NOT_A_PATH_CHARACTER = /[\s"<>|`]/;

/** A path separator, of either kind. */
export const SEPARATOR = /[\\/]/;

/** A mark that ends a clause and cannot be part of a name: a colon or a semicolon. */
const CLAUSE_END = /[:;]/;

/** White space inside a line: a space, a tab, a no-break space. */
const SPACE_IN_A_LINE = /[^\S\r\n\u2028\u2029]/u;

/** A character that can be part of a path written without quotes. */
function isPathCharacter(character: string | undefined): boolean {
  return character !== undefined && !NOT_A_PATH_CHARACTER.test(character);
}

/**
 * How far a closing quote is looked for, in characters.
 *
 * A bound, because unbounded, the search for a closing quote would run to the
 * end of the text for every quoted root, which on a long pasted note would make
 * redaction quadratic. A path without quotes is not bounded by it: cut at the
 * bound, the tail of a path that crosses it would keep its last folders and its
 * name.
 */
const LONGEST_PATH = 4096;

/**
 * What ends a word in a sentence: a mark of punctuation, a closing bracket or a
 * closing quote, with nothing but more of them after it.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** The quotes a path can be written in. */
const OPENING_QUOTES = ['"', "'", '`'] as const;

/**
 * Where every quote that could close a quoted path is in one text, and where
 * every line ends, read once for the whole text and asked of each quoted root.
 *
 * Were each root to read a {@link LONGEST_PATH} window of its own looking for a
 * closing quote, a text of nothing but roots that open one and never close it
 * would pay the whole window for each: a megabyte of `'C:\` takes about four
 * seconds that way, a thousand times the cost of ordinary prose. The index
 * keeps where the quotes and the line ends are, and none of the text, so no
 * answer reads the text again.
 */
export interface QuoteIndex {
  /**
   * Where a path written in `quote` and read from `from` ends: at the last of
   * the same quote on its line that ends a word, within {@link LONGEST_PATH} of
   * `from`, or `undefined` where there is none. An apostrophe inside a name,
   * `O'Brien`, is followed by a letter; a possessive, `Chris' Demos`, is
   * followed by a space, and ended at the first such quote, the path would
   * leave the folders after it. Taking the last removes whatever else is quoted
   * on the line with it, which costs a reader some words and never a name.
   */
  closingQuote(from: number, quote: string): number | undefined;
}

/** Reads a text once for every quote that ends a word, and every line end. */
export function indexQuotes(text: string): QuoteIndex {
  const closings = new Map<string, number[]>(OPENING_QUOTES.map((quote) => [quote, []]));
  const lineEnds: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (character === '\n') {
      lineEnds.push(index);
      continue;
    }
    const found = closings.get(character);
    if (found !== undefined && !WORD_CHARACTER.test(text[index + 1] ?? '')) found.push(index);
  }

  const { length } = text;
  return {
    closingQuote: (from, quote) => {
      const found = closings.get(quote);
      if (found === undefined) return undefined;

      const lineEnd = lineEnds[firstAtOrAfter(lineEnds, from)] ?? length;
      const limit = Math.min(length, from + LONGEST_PATH, lineEnd);

      const last = found[firstAtOrAfter(found, limit) - 1];
      return last !== undefined && last >= from ? last : undefined;
    },
  };
}

/** The first entry of a sorted list at or after `from`, or the list's length. */
function firstAtOrAfter(sorted: readonly number[], from: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? 0) < from) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Where a path written without quotes ends.
 *
 * A path is read as runs of path characters with any white space inside a line
 * between each: ended at one space, a path followed by two spaces, a tab or a
 * no-break space would leave the rest of a name standing after it. Every run up
 * to the last that holds a separator is part of the path: `Alex Bloggs\Music`
 * is one folder, not the end of the path and a word. The final segment, after
 * the last separator, is where a path and a sentence meet. Its words are read
 * in turn, and the path ends:
 *
 * - after a word ending in a user file's extension, so `take 3.wav for import`
 *   keeps `for import`;
 * - before a colon or a semicolon ending a word, so `notes: permission denied`
 *   keeps its reason. Neither can be part of a name on Windows, and neither is
 *   usual in one elsewhere. Every other mark can be: `J. Smith`, `Smith, Jane`,
 *   `Ep. 12` and `Smith v. van Dijk` would each leave the rest of a name
 *   standing were the mark, or the mark before lower-case prose, to end the
 *   path;
 * - otherwise at the end of the runs. `Jane Smith Interview and then` is
 *   removed whole: stopped at the first space, the path would leave the surname
 *   standing after the placeholder, which is the failure REQ-PRIV-161 is about.
 *   Removing a few words of the sentence is the cost of never leaving a name
 *   behind.
 */
function unquotedEnd(text: string, from: number): number {
  const runs: { readonly start: number; readonly end: number }[] = [];
  let index = from;
  for (;;) {
    let end = index;
    while (isPathCharacter(text[end])) end += 1;
    if (end === index) break;
    runs.push({ start: index, end });

    let next = end;
    while (SPACE_IN_A_LINE.test(text[next] ?? '')) next += 1;
    if (next === end || !isPathCharacter(text[next])) break;
    index = next;
  }

  const lastFolder = runs.findLastIndex((run) => SEPARATOR.test(text.slice(run.start, run.end)));

  for (let position = Math.max(0, lastFolder); position < runs.length; position += 1) {
    const run = runs[position];
    if (run === undefined) break;

    // The final segment begins after the last separator of the last run that
    // has one; every later run is a word of it whole.
    const wordStart =
      position === lastFolder ? lastSeparatorIn(text, run.start, run.end) + 1 : run.start;
    const word = text.slice(wordStart, run.end);
    const bare = word.replace(TRAILING_PUNCTUATION, '');

    if (USER_FILE_END.test(bare)) return wordStart + bare.length;
    if (CLAUSE_END.test(word.slice(bare.length))) return wordStart + bare.length;
  }

  return runs.at(-1)?.end ?? from;
}

/** The index of the last separator inside a run, or one before its start when it has none. */
export function lastSeparatorIn(text: string, start: number, end: number): number {
  for (let index = end - 1; index >= start; index -= 1) {
    if (SEPARATOR.test(text[index] ?? '')) return index;
  }
  return start - 1;
}

/**
 * Where the path whose root is at `start` ends, a quoted one's answered from
 * `index`, the text's quote index.
 */
function pathEnd(text: string, start: number, afterRoot: number, index: QuoteIndex): number {
  const before = text[start - 1];
  if (before === '"' || before === "'" || before === '`') {
    const end = index.closingQuote(afterRoot, before);
    if (end !== undefined) return end;
  }
  return unquotedEnd(text, afterRoot);
}

/** A character of white space. */
const WHITE_SPACE = /\s/;

/**
 * Where an address that starts at `start`, read on from `from`, ends: a web
 * address at white space, as the address rule in `redaction.ts` reads one, and
 * an address under any other scheme, or none, where a path ends, since the
 * path rules read it as a path on a share. `scheme` is as written from where
 * the address starts, its run included, and `index` is the text's quote index
 * ({@link indexQuotes}).
 */
export function addressEnd(
  text: string,
  start: number,
  from: number,
  scheme: string | undefined,
  index: QuoteIndex,
): number {
  if (scheme === undefined || !WEB_SCHEME.test(scheme)) {
    return pathEnd(text, start, from, index);
  }
  let end = from;
  while (end < text.length && !WHITE_SPACE.test(text[end] ?? '')) end += 1;
  return end;
}

/**
 * The kinds of file whose name can appear in a record with no path around it.
 *
 * A bare name has no shape but its extension, so the rule is a list: the audio,
 * video, project, engine and document files AudioGubbins opens, saves or is
 * handed. A source file of AudioGubbins itself, such as `codec.ts` in a stack
 * frame, is not on it, because its name is public and is what makes the frame
 * useful. A phase that opens a new kind of file adds its extension here.
 */
const USER_FILE_EXTENSIONS = [
  // Audio.
  'wav',
  'wave',
  'bwf',
  'rf64',
  'w64',
  'aif',
  'aiff',
  'aifc',
  'caf',
  'flac',
  'alac',
  'mp3',
  'mp2',
  'ogg',
  'oga',
  'opus',
  'spx',
  'm4a',
  'm4b',
  'aac',
  'wma',
  'wv',
  'ape',
  'mka',
  'weba',
  'amr',
  'au',
  'snd',
  'mid',
  'midi',
  'sf2',
  'sfz',
  'pcm',
  'raw',
  'dsf',
  'dff',
  'ac3',
  // The interchange formats a session is handed over in.
  'aaf',
  'omf',
  // Video, which audio is often imported from.
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'mpg',
  'mpeg',
  'wmv',
  '3gp',
  // Godot projects and resources.
  'godot',
  'tscn',
  'tres',
  'gd',
  'res',
  'scn',
  'pck',
  // Middleware banks, and the tracker modules game audio is still made in.
  'wem',
  'bnk',
  'bank',
  'fsb',
  'xm',
  'mod',
  'it',
  's3m',
  // Other audio editors' projects, which a user imports from.
  'aup',
  'aup3',
  'rpp',
  'als',
  'ptx',
  'flp',
  'sesx',
  'logicx',
  'band',
  'cpr',
  'song',
  'bwproject',
  'dawproject',
  // Documents, images and archives a user hands over.
  'zip',
  'rar',
  '7z',
  'json',
  'txt',
  'csv',
  'xml',
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'md',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'heic',
  'gif',
  'webp',
  'svg',
  'tif',
  'tiff',
  'bmp',
] as const;

/** Whether a word ends in a user file's extension, which ends a path's last segment. */
const USER_FILE_END = new RegExp(String.raw`\.(?:${USER_FILE_EXTENSIONS.join('|')})$`, 'i');

/**
 * The kinds of file a build of AudioGubbins is served as, which a stack frame
 * names and a source map is read by.
 */
const SERVED_FILE_EXTENSIONS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'css', 'html', 'map', 'wasm'];

/** The kinds of file a build is served as, written for an alternation. */
export const SERVED_FILE_KINDS = SERVED_FILE_EXTENSIONS.join('|');

/** A file's kind, with a stack frame's line and column after it where it has them. */
const FILE_KIND_END = new RegExp(
  String.raw`\.(?:${USER_FILE_EXTENSIONS.join('|')}|${SERVED_FILE_KINDS})(?::\d+){0,2}$`,
  'i',
);

/**
 * Whether a segment names a file, and so may be kept where the user asked for
 * file names.
 *
 * A segment that names no file is not a name to keep, and the placeholder
 * stands alone. Four such segments look like names and are not: an account
 * folder, `C:\Users\Jane Smith`; a folder at the end of a share,
 * `smb://NAS/Jane Smith/Private`; a path inside an address's query,
 * `sftp://host/a/take.wav?next=/home/jane.smith`; and the authority of an
 * address with no path at all, which carries its credentials with it,
 * `https://admin:hunter2@host:8080`.
 *
 * A stack frame's line and column follow the kind, `index-1a2b.js:3:14`, and
 * are the part a source map needs. The closing bracket a frame is written
 * inside is punctuation of the sentence, not of the name.
 */
export function namesAFile(segment: string): boolean {
  return FILE_KIND_END.test(segment.replace(TRAILING_PUNCTUATION, ''));
}

/** A user file's extension, where nothing that could continue the name follows. */
const USER_FILE_EXTENSION = new RegExp(
  String.raw`\.(?:${USER_FILE_EXTENSIONS.join('|')})(?![\p{L}\p{N}_-])`,
  'giu',
);

/**
 * A character a log does not put inside a file's name: an angle bracket, a bar
 * or a backtick. None is allowed in a name on Windows, and each is how a
 * placeholder or a code span marks a name off. A double quote is paired as the
 * other quotes are, because a name on macOS or Linux can hold one: ending the
 * walk, it would leave `Jane "Mimi" ` before the placeholder of
 * `Jane "Mimi" Smith.wav`.
 */
const NOT_IN_A_NAME = /[<>|`]/;

/** The end of a line, which a name never crosses. */
const LINE_END = /[\r\n\u2028\u2029]/u;

/** What separates a name from what is before it, without being part of it. */
const BEFORE_A_NAME = /[\s,;]/u;

/** A letter or a digit, which every name holds at least one of. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Each quote that can open a name, and the quote that closes it. */
const CLOSING_QUOTES: ReadonlyMap<string, string> = new Map([
  ["'", "'"],
  ['"', '"'],
  ['‘', '’'],
  ['“', '”'],
  ['«', '»'],
  ['„', '“'],
]);

/**
 * Where each user file's name in a text starts and ends, in order, for a name
 * written without an absolute path: the form a browser gives a page, which
 * sees a file's name and never its path.
 *
 * The name is read back from its extension to the first thing no name holds:
 * the start of the text or of its line, a double quote, a bracket of angles, a
 * bar or a backtick, a label or a clause ended by a colon or a semicolon, or
 * the end of the name before it. Every word on the way is taken, whatever it
 * looks like, because nothing else tells a name from the sentence it is in:
 * stopped at a lower-case word, `jane smith interview.wav`,
 * `Maria de la Cruz.wav` and `Jane Smith and Bob Jones.wav` would each leave a
 * person's name before the placeholder. Taking the words of the sentence before
 * a name is the cost of never leaving a part of it behind, the trade the path
 * rules make; a file's name is best logged as a field, which is removed whole,
 * or after a colon or in quotes, where it ends.
 *
 * A name in quotes starts after its opening quote, when the same pair closes it
 * straight after the extension. A bracket is part of a name, as the `(1)` a
 * browser gives a second download is: read as the end of one, it would leave
 * `Interview (1).wav` unfound.
 *
 * `placeholders` are the marks a path's or an address's redaction leaves: a
 * name straight after one and a separator is the one that redaction kept on
 * the user's instruction, and is left alone.
 *
 * Each name is read back no further than the end of the one before, so the text
 * is read once however many names it holds: read further, two names in one
 * sentence would both be read back to its start, and the first would be written
 * twice.
 */
export function userFileNamesIn(
  text: string,
  placeholders: readonly string[] = [],
): readonly { readonly start: number; readonly end: number }[] {
  const found: { readonly start: number; readonly end: number }[] = [];
  let floor = 0;

  for (const extension of text.matchAll(USER_FILE_EXTENSION)) {
    const at = extension.index;
    const end = at + extension[0].length;
    const previousEnd = floor;
    floor = end;

    if (SPACE_IN_A_LINE.test(text[at - 1] ?? ' ')) continue;

    // A name with an address straight after it is that address's local part,
    // not a file: read as a name, `jane.mp3@example.com` would lose the person
    // and leave the domain standing. The e-mail rule takes the whole of it.
    if (text[end] === '@') continue;

    const start = nameStart(text, at, end, previousEnd);
    if (!LETTER_OR_DIGIT.test(text.slice(start, at))) continue;
    if (keptByARedaction(text, start, end, placeholders)) continue;
    found.push({ start, end });
  }

  return found;
}

/** Where the name whose extension is at `at`, and which ends at `end`, starts. */
function nameStart(text: string, at: number, end: number, floor: number): number {
  let start = at;
  while (start > floor) {
    const before = text[start - 1] ?? '';
    if (LINE_END.test(before) || NOT_IN_A_NAME.test(before)) break;
    if (CLAUSE_END.test(before) && SPACE_IN_A_LINE.test(text[start] ?? '')) break;
    start -= 1;
  }

  while (start < at && BEFORE_A_NAME.test(text[start] ?? '')) start += 1;

  // A quote straight after the extension closes the name only when no letter
  // follows it: `Smith.wav's` is a possessive, and read as a closing quote it
  // would pair with the quote inside `'Mimi'` and leave `Jane ` standing.
  const after = text[end];
  const closes = after !== undefined && !LETTER_OR_DIGIT.test(text[end + 1] ?? '');
  return closes ? afterOpeningQuote(text, start, at, after) : start;
}

/**
 * Where a name starts inside the quote that `closing` pairs with, between
 * `start` and `at`; `start` when none does.
 *
 * Read back from the extension, a quote with a letter before it closes an inner
 * quotation and one without opens one, so the opening quote the name's own
 * closing quote pairs with is one that opens with none left open inside it:
 * `'The 'Best' Take.wav'` starts at `The`, and `{"file":"Jane.wav"}` at `Jane`.
 * Where more than one such quote is left, the name can be read from any of
 * them, and it is read from the first: read from the last, `"Jane "Mimi.wav"`
 * would leave `Jane ` standing before the placeholder.
 */
function afterOpeningQuote(text: string, start: number, at: number, closing: string): number {
  let open = 0;
  let from = start;
  for (let index = at - 1; index >= start; index -= 1) {
    const character = text[index] ?? '';
    const opens =
      CLOSING_QUOTES.get(character) === closing && !LETTER_OR_DIGIT.test(text[index - 1] ?? '');
    if (opens && open === 0) from = index + 1;
    else if (opens) open -= 1;
    else if (character === closing) open += 1;
  }
  return from;
}

/**
 * Whether the name from `start` to `end` follows one of `placeholders` and a
 * separator, with no separator after it: the one name a redaction kept. With a
 * folder after it, it is not: after an address that ends at a space, the
 * folders of `Jane Smith/take.wav` would otherwise be taken for its kept name.
 */
function keptByARedaction(
  text: string,
  start: number,
  end: number,
  placeholders: readonly string[],
): boolean {
  return (
    SEPARATOR.test(text[start] ?? '') &&
    !SEPARATOR.test(text.slice(start + 1, end)) &&
    placeholders.some((placeholder) => text.startsWith(placeholder, start - placeholder.length))
  );
}

/**
 * Where each absolute path in a text starts and ends, in order.
 *
 * Each quoted root is answered from one index of the text, which `indexOf`
 * builds: {@link indexQuotes}, unless the caller counts what the finding asks
 * of it, as its tests do to hold it to one reading of the text however many
 * roots it holds.
 */
export function absolutePathsIn(
  text: string,
  indexOf: (text: string) => QuoteIndex = indexQuotes,
): readonly { readonly start: number; readonly end: number }[] {
  const found: { readonly start: number; readonly end: number }[] = [];
  // Built once, on the first root, and asked after that. Built for every text,
  // it would read a text that holds no path at all.
  let index: QuoteIndex | undefined;
  let taken = 0;

  for (const root of text.matchAll(PATH_ROOT)) {
    // A root inside a path already found, `/b` in `C:/a/b`, is part of it.
    if (root.index < taken) continue;

    index ??= indexOf(text);
    const end = pathEnd(text, root.index, root.index + root[0].length, index);
    found.push({ start: root.index, end });
    taken = end;
  }

  return found;
}
