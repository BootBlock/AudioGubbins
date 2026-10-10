/**
 * Text read from a file's metadata, which is untrusted (REQ-EXEC-136), and the
 * bytes a writer stores text as.
 *
 * The rule for reading: a field ends at its first NUL, as RIFF's ZSTR fields
 * and fixed-width fields padded with NULs both require. Its bytes are decoded
 * as UTF-8 where all of them are valid UTF-8 (RFC 3629: no overlong form, no
 * surrogate, nothing past U+10FFFF), and otherwise as Latin-1, one byte one
 * character, so legacy ANSI and Mac text still reads as something rather than
 * being refused; a field is never decoded half one way and half the other. C0
 * and C1 control characters and DEL are then removed, so a value cannot carry
 * an escape sequence to a terminal or a log; long text, such as a comment or a
 * coding history, keeps tab, line feed and carriage return, because the
 * Broadcast Wave coding history separates its lines with CR LF. Finally the
 * text is cut at its bound, in characters (code points), so a hostile field
 * costs no more than the bound however long it claims to be.
 *
 * Writers store text as UTF-8, and only text that `readsBackUnchanged`, so a
 * field written is a field read back.
 */

import type { MetadataTextKey } from './metadata-map.js';

/** How one kind of field is read: its bound in characters, and whether it keeps line breaks. */
export interface TextRules {
  readonly maximumCharacters: number;
  readonly multiline: boolean;
}

/** A name or a one-line field: a title, an artist, a cue's label. */
export const LINE_TEXT: TextRules = { maximumCharacters: 1_024, multiline: false };

/** A comment, a coding history, or a field of unknown meaning kept by its own key. */
export const LONG_TEXT: TextRules = { maximumCharacters: 65_536, multiline: true };

/** A whole document kept as text, such as a WAV's iXML. */
export const DOCUMENT_TEXT: TextRules = { maximumCharacters: 262_144, multiline: true };

/**
 * Every typed key, in the one order writers report what they drop, so the same
 * map gives the same report.
 */
export const TEXT_KEYS = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNumber',
  'trackTotal',
  'discNumber',
  'discTotal',
  'date',
  'genre',
  'comment',
  'copyright',
  'encoder',
  'isrc',
] as const satisfies readonly MetadataTextKey[];

/** How a typed key's value is read: a comment keeps its lines, every other key is one line. */
export function textRulesOf(key: MetadataTextKey): TextRules {
  return key === 'comment' ? LONG_TEXT : LINE_TEXT;
}

/** How many characters are turned into a string at once, well inside any engine's argument limit. */
const CHARACTERS_PER_PIECE = 4_096;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const REPLACEMENT_CHARACTER = 0xfffd;

/** Whether a character survives reading: no C0, DEL or C1 control, but for long text's line breaks. */
function isKept(point: number, multiline: boolean): boolean {
  if (point < 0x20) {
    return multiline && (point === TAB || point === LINE_FEED || point === CARRIAGE_RETURN);
  }
  return point < 0x7f || point > 0x9f;
}

/** Whether a byte continues a UTF-8 sequence. */
function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

/** The bytes of the UTF-8 sequence a lead byte begins, or 0 where no valid one begins with it. */
function sequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

/** The character of a sequence whose bytes have been checked to be lead and continuations. */
function sequencePoint(bytes: Uint8Array, at: number, length: number): number {
  const lead = bytes[at] ?? 0;
  if (length === 1) return lead;
  let point = lead & (0xff >> (length + 1));
  for (let index = 1; index < length; index += 1) {
    point = point * 64 + ((bytes[at + index] ?? 0) & 0x3f);
  }
  return point;
}

/** The smallest character each sequence length may encode, refusing overlong forms. */
const LEAST_POINT: readonly number[] = [0, 0, 0x80, 0x800, 0x10000];

/** The length of the valid UTF-8 sequence at `at`, or 0 where the bytes there are not one. */
function validSequenceAt(bytes: Uint8Array, at: number): number {
  const length = sequenceLength(bytes[at] ?? 0);
  if (length === 0 || at + length > bytes.length) return 0;
  for (let index = 1; index < length; index += 1) {
    if (!isContinuation(bytes[at + index])) return 0;
  }
  const point = sequencePoint(bytes, at, length);
  const surrogate = point >= 0xd800 && point <= 0xdfff;
  return point < (LEAST_POINT[length] ?? 0) || surrogate || point > 0x10ffff ? 0 : length;
}

/** Whether every byte belongs to a valid UTF-8 sequence. */
function isUtf8(bytes: Uint8Array): boolean {
  for (let at = 0; at < bytes.length;) {
    const length = validSequenceAt(bytes, at);
    if (length === 0) return false;
    at += length;
  }
  return true;
}

/** The characters of the bytes, as UTF-8 where `utf8` and as Latin-1 otherwise, lazily. */
function* charactersOf(bytes: Uint8Array, utf8: boolean): Generator<number> {
  for (let at = 0; at < bytes.length;) {
    const length = utf8 ? sequenceLength(bytes[at] ?? 0) : 1;
    yield sequencePoint(bytes, at, length);
    at += length;
  }
}

/** Decodes a field's bytes by the rule the module states. */
export function decodeText(bytes: Uint8Array, rules: TextRules): string {
  const terminator = bytes.indexOf(0);
  const field = terminator === -1 ? bytes : bytes.subarray(0, terminator);
  const pieces: string[] = [];
  let piece: number[] = [];
  let kept = 0;
  for (const point of charactersOf(field, isUtf8(field))) {
    if (kept === rules.maximumCharacters) break;
    if (!isKept(point, rules.multiline)) continue;
    piece.push(point);
    kept += 1;
    if (piece.length === CHARACTERS_PER_PIECE) {
      pieces.push(String.fromCodePoint(...piece));
      piece = [];
    }
  }
  pieces.push(String.fromCodePoint(...piece));
  return pieces.join('');
}

/**
 * Whether `decodeText` gives this text back from its UTF-8 bytes: no character
 * it removes, no unpaired surrogate (which UTF-8 cannot hold), and no more
 * characters than the bound. A writer stores only such text, so it never writes
 * a field that reads back as something else.
 */
export function readsBackUnchanged(text: string, rules: TextRules): boolean {
  let characters = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) return false;
    if (!isKept(point, rules.multiline)) return false;
    characters += 1;
  }
  return characters <= rules.maximumCharacters;
}

/** Text cut to the bound of its rules, never inside a character. */
export function cutText(text: string, rules: TextRules): string {
  let characters = 0;
  let end = 0;
  for (const character of text) {
    if (characters === rules.maximumCharacters) return text.slice(0, end);
    characters += 1;
    end += character.length;
  }
  return text;
}

/** The UTF-8 bytes of text, an unpaired surrogate as U+FFFD. */
export function encodeText(text: string): Uint8Array {
  const out: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const point = code >= 0xd800 && code <= 0xdfff ? REPLACEMENT_CHARACTER : code;
    if (point < 0x80) {
      out.push(point);
    } else if (point < 0x800) {
      out.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      out.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}
