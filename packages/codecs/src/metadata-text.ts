/**
 * Text read from a file's metadata, which is untrusted (REQ-EXEC-136), and the
 * bytes a writer stores text as: one rule for every format, in two steps.
 *
 * Decoding. A value ends at its first NUL, as RIFF's ZSTR fields, fixed-width
 * fields padded with NULs and ID3's terminated strings all require. Its bytes
 * are then decoded in the coding its format states:
 *
 * - `utf-8`: Vorbis comments, MP4 `ilst` items, FLAC picture descriptions and
 *   ID3v2 encoding 3. Each maximal ill-formed sequence is read as one U+FFFD,
 *   as the WHATWG decoder does, so a tag with one bad byte is still a tag.
 * - `utf-16` and `utf-16be`: ID3v2 encodings 1 and 2, in the order a leading
 *   byte order mark states, else little- or big-endian; a lone surrogate and
 *   an odd last byte are read as U+FFFD.
 * - `latin-1`: ID3v1, ID3v2 encoding 0 and media types, one byte one character.
 * - `unstated`: RIFF and IFF text, whose formats name no coding. The bytes are
 *   read as UTF-8 where all of them are valid UTF-8 (RFC 3629), and otherwise
 *   as Latin-1, so legacy ANSI and Mac text still reads as something; a value
 *   is never decoded half one way and half the other.
 *
 * Keeping. Whatever the coding, C0 and C1 control characters and DEL are then
 * removed, so a value cannot carry an escape sequence to a terminal or a log;
 * long text, such as a comment or a coding history, keeps tab, line feed and
 * carriage return, because the Broadcast Wave coding history separates its
 * lines with CR LF. Finally the text is cut at its bound, in characters (code
 * points), so a hostile value costs no more than the bound however long it
 * claims to be.
 *
 * Writers store text as UTF-8, or Latin-1 where a field holds nothing else,
 * and only text that `readsBackUnchanged`, so a field written is a field read
 * back. Written out rather than taken from the platform, since this package
 * compiles against the ES2023 library alone, where `TextEncoder` and
 * `TextDecoder` do not exist.
 */

import {
  MAXIMUM_DOCUMENT_CHARACTERS,
  MAXIMUM_LINE_CHARACTERS,
  MAXIMUM_LONG_TEXT_CHARACTERS,
} from './metadata-limits.js';
import type { MetadataTextKey } from './metadata-map.js';

/** The coding a format stores a value's text in, or `unstated` where its format names none. */
export type TextCoding = 'utf-8' | 'utf-16' | 'utf-16be' | 'latin-1' | 'unstated';

/** How one kind of field is kept: its bound in characters, and whether it keeps line breaks. */
export interface TextRules {
  readonly maximumCharacters: number;
  readonly multiline: boolean;
}

/** A name or a one-line field: a title, an artist, a cue's label, a key. */
export const LINE_TEXT: TextRules = {
  maximumCharacters: MAXIMUM_LINE_CHARACTERS,
  multiline: false,
};

/** A comment, a coding history, or a field of unknown meaning kept by its own key. */
export const LONG_TEXT: TextRules = {
  maximumCharacters: MAXIMUM_LONG_TEXT_CHARACTERS,
  multiline: true,
};

/** A whole document kept as text, such as a WAV's iXML. */
export const DOCUMENT_TEXT: TextRules = {
  maximumCharacters: MAXIMUM_DOCUMENT_CHARACTERS,
  multiline: true,
};

/**
 * Every typed key, in the one order writers write them and report what they
 * drop, so the same map gives the same bytes and the same report.
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

/** How a typed key's value is kept: a comment keeps its lines, every other key is one line. */
export function textRulesOf(key: MetadataTextKey): TextRules {
  return key === 'comment' ? LONG_TEXT : LINE_TEXT;
}

/** The character a malformed sequence or a lone surrogate is read and written as. */
const REPLACEMENT = 0xfffd;

/** How many code units are gathered before they are turned into text, few enough for one call's arguments. */
const UNITS_PER_FLUSH = 4_096;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** Turns code units into text a flush at a time. */
class UnitText {
  private readonly pieces: string[] = [];
  private readonly units: number[] = [];

  push(unit: number): void {
    this.units.push(unit);
    if (this.units.length >= UNITS_PER_FLUSH) this.flush();
  }

  pushPoint(point: number): void {
    if (point > 0xffff) {
      this.push(0xd800 + ((point - 0x10000) >> 10));
      this.push(0xdc00 + ((point - 0x10000) & 0x3ff));
    } else {
      this.push(point);
    }
  }

  finish(): string {
    this.flush();
    return this.pieces.join('');
  }

  private flush(): void {
    this.pieces.push(String.fromCharCode(...this.units));
    this.units.length = 0;
  }
}

/** The byte at an offset the caller has checked is inside `bytes`. */
function byteAt(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

/** The bytes before the first NUL byte, for a coding of one-byte units. */
function beforeNul(bytes: Uint8Array): Uint8Array {
  const terminator = bytes.indexOf(0);
  return terminator === -1 ? bytes : bytes.subarray(0, terminator);
}

/** A UTF-8 sequence a lead byte begins. */
interface Utf8Sequence {
  /** The continuation bytes it needs. */
  readonly needed: number;

  /** The lead byte's bits of the character. */
  readonly bits: number;

  /** The range its first continuation byte must lie in. */
  readonly lower: number;
  readonly upper: number;
}

/**
 * What a UTF-8 lead byte begins: the continuation bytes it needs, its bits of
 * the character, and the range its first continuation must lie in, which
 * refuses overlong forms, surrogates and characters past U+10FFFF; or
 * `undefined` for a byte that begins no sequence.
 */
function sequenceOf(lead: number): Utf8Sequence | undefined {
  if (lead >= 0xc2 && lead <= 0xdf)
    return { needed: 1, bits: lead & 0x1f, lower: 0x80, upper: 0xbf };
  if (lead >= 0xe0 && lead <= 0xef) {
    return {
      needed: 2,
      bits: lead & 0x0f,
      lower: lead === 0xe0 ? 0xa0 : 0x80,
      upper: lead === 0xed ? 0x9f : 0xbf,
    };
  }
  if (lead >= 0xf0 && lead <= 0xf4) {
    return {
      needed: 3,
      bits: lead & 0x07,
      lower: lead === 0xf0 ? 0x90 : 0x80,
      upper: lead === 0xf4 ? 0x8f : 0xbf,
    };
  }
  return undefined;
}

/**
 * The character a sequence's continuation bytes from `offset` complete, and
 * where they end; the character is `undefined` where a byte is out of range,
 * which ends the ill-formed subpart before that byte.
 */
function continued(
  bytes: Uint8Array,
  offset: number,
  sequence: Utf8Sequence,
): { readonly point: number | undefined; readonly end: number } {
  let point = sequence.bits;
  let { lower, upper } = sequence;
  for (let index = 0; index < sequence.needed; index += 1) {
    const at = offset + index;
    const next = at < bytes.length ? byteAt(bytes, at) : -1;
    if (next < lower || next > upper) return { point: undefined, end: at };
    lower = 0x80;
    upper = 0xbf;
    point = (point << 6) | (next & 0x3f);
  }
  return { point, end: offset + sequence.needed };
}

/**
 * Decodes UTF-8, each maximal ill-formed subpart read as one U+FFFD (the WHATWG
 * decoder's rule, from Unicode's "best practice" for replacement), and answers
 * whether every byte was well formed.
 */
function decodeUtf8(bytes: Uint8Array): { readonly text: string; readonly wellFormed: boolean } {
  const text = new UnitText();
  let wellFormed = true;
  let offset = 0;
  while (offset < bytes.length) {
    const lead = byteAt(bytes, offset);
    offset += 1;
    if (lead < 0x80) {
      text.push(lead);
      continue;
    }
    const sequence = sequenceOf(lead);
    const { point, end } =
      sequence === undefined
        ? { point: undefined, end: offset }
        : continued(bytes, offset, sequence);
    offset = end;
    if (point === undefined) wellFormed = false;
    text.pushPoint(point ?? REPLACEMENT);
  }
  return { text: text.finish(), wellFormed };
}

/** Decodes ISO 8859-1, every byte the character of that number. */
function decodeLatin1(bytes: Uint8Array): string {
  const text = new UnitText();
  for (const byte of bytes) text.push(byte);
  return text.finish();
}

/**
 * Decodes UTF-16 up to its first NUL unit, in the byte order a leading byte
 * order mark states, or in `defaultBigEndian`'s where there is none, the mark
 * itself not kept. A lone surrogate and an odd last byte are read as U+FFFD.
 */
function decodeUtf16(bytes: Uint8Array, defaultBigEndian: boolean): string {
  let bigEndian = defaultBigEndian;
  let offset = 0;
  if (bytes.length >= 2) {
    const first = byteAt(bytes, 0);
    const second = byteAt(bytes, 1);
    if (first === 0xfe && second === 0xff) {
      bigEndian = true;
      offset = 2;
    } else if (first === 0xff && second === 0xfe) {
      bigEndian = false;
      offset = 2;
    }
  }
  const unitAt = (at: number): number =>
    bigEndian
      ? (byteAt(bytes, at) << 8) | byteAt(bytes, at + 1)
      : byteAt(bytes, at) | (byteAt(bytes, at + 1) << 8);

  const text = new UnitText();
  while (offset + 1 < bytes.length) {
    const unit = unitAt(offset);
    if (unit === 0) return text.finish();
    offset += 2;
    if (unit >= 0xd800 && unit <= 0xdbff && offset + 1 < bytes.length) {
      const next = unitAt(offset);
      if (next >= 0xdc00 && next <= 0xdfff) {
        text.push(unit);
        text.push(next);
        offset += 2;
        continue;
      }
    }
    text.push(unit >= 0xd800 && unit <= 0xdfff ? REPLACEMENT : unit);
  }
  if (offset < bytes.length) text.push(REPLACEMENT);
  return text.finish();
}

/**
 * A value's bytes decoded in its coding, up to its first NUL: the first step of
 * the rule the module states. Text a person will see is then kept by
 * {@link keptText}; {@link readText} does both.
 */
export function decodeText(bytes: Uint8Array, coding: TextCoding): string {
  switch (coding) {
    case 'utf-8':
      return decodeUtf8(beforeNul(bytes)).text;
    case 'utf-16':
      return decodeUtf16(bytes, false);
    case 'utf-16be':
      return decodeUtf16(bytes, true);
    case 'latin-1':
      return decodeLatin1(beforeNul(bytes));
    case 'unstated': {
      const field = beforeNul(bytes);
      const utf8 = decodeUtf8(field);
      return utf8.wellFormed ? utf8.text : decodeLatin1(field);
    }
  }
}

/** Whether a character survives keeping: no C0, DEL or C1 control, but for long text's line breaks. */
function isKept(point: number, multiline: boolean): boolean {
  if (point < 0x20) {
    return multiline && (point === TAB || point === LINE_FEED || point === CARRIAGE_RETURN);
  }
  return point < 0x7f || point > 0x9f;
}

/** Decoded text kept by its rules: its control characters removed and the rest cut at the bound. */
export function keptText(text: string, rules: TextRules): string {
  const kept: string[] = [];
  for (const character of text) {
    if (kept.length === rules.maximumCharacters) break;
    if (isKept(character.codePointAt(0) ?? 0, rules.multiline)) kept.push(character);
  }
  return kept.join('');
}

/** A value's bytes read by the whole rule the module states: decoded in its coding, then kept. */
export function readText(bytes: Uint8Array, coding: TextCoding, rules: TextRules): string {
  return keptText(decodeText(bytes, coding), rules);
}

/**
 * Whether reading gives this text back from its UTF-8 bytes: no character
 * keeping removes, no NUL, no unpaired surrogate (which UTF-8 cannot hold), and
 * no more characters than the bound. A writer stores only such text, so it
 * never writes a field that reads back as something else.
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

/** The code point at `index` of `text` and how many units it took, a lone surrogate read as U+FFFD. */
function pointAt(text: string, index: number): readonly [point: number, units: number] {
  const unit = text.charCodeAt(index);
  if (unit < 0xd800 || unit > 0xdfff) return [unit, 1];
  const next = text.charCodeAt(index + 1);
  if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return [0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00), 2];
  }
  return [REPLACEMENT, 1];
}

/** The bytes of `text` in UTF-8, a lone surrogate written as U+FFFD, since it has no UTF-8 form. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length;) {
    const [point, units] = pointAt(text, index);
    index += units;
    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** The bytes of `text` in ISO 8859-1, or `undefined` where a character has no Latin-1 form. */
export function encodeLatin1(text: string): Uint8Array | undefined {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit > 0xff) return undefined;
    bytes[index] = unit;
  }
  return bytes;
}
