/**
 * Strict UTF-8, written out rather than taken from the platform.
 *
 * Every file this package describes is UTF-8 (REQ-STOR-026), and the package
 * compiles against the ES2023 library alone, where `TextEncoder` and
 * `TextDecoder` do not exist. The platform decoder would be the wrong tool in
 * any case: it replaces a malformed byte with U+FFFD and carries on, so a torn
 * or tampered project file would be read as a slightly different project rather
 * than refused (REQ-EXEC-136.12).
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

/**
 * How many decoded code units are gathered before they are turned into text.
 *
 * Large enough that building the string costs little per unit, and small enough
 * to pass as the arguments of one call on every engine.
 */
const UNITS_PER_FLUSH = 4_096;

/**
 * The bytes of `text` in UTF-8.
 *
 * Throws a `RangeError` on a lone surrogate, which has no UTF-8 form. That is a
 * programmer error here rather than an input to repair: the canonical JSON
 * writer escapes a lone surrogate as `\uXXXX`, so every text it produces is
 * well formed, and replacing the unit with U+FFFD would write a project that
 * reads back as something other than what was saved.
 */
export function encodeUtf8(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(encodedLength(text));
  let offset = 0;

  for (let index = 0; index < text.length; index += 1) {
    const point = codePointAt(text, index);
    if (point > 0xffff) index += 1;

    if (point < 0x80) {
      bytes[offset] = point;
      offset += 1;
    } else if (point < 0x800) {
      bytes[offset] = 0xc0 | (point >> 6);
      bytes[offset + 1] = 0x80 | (point & 0x3f);
      offset += 2;
    } else if (point < 0x10000) {
      bytes[offset] = 0xe0 | (point >> 12);
      bytes[offset + 1] = 0x80 | ((point >> 6) & 0x3f);
      bytes[offset + 2] = 0x80 | (point & 0x3f);
      offset += 3;
    } else {
      bytes[offset] = 0xf0 | (point >> 18);
      bytes[offset + 1] = 0x80 | ((point >> 12) & 0x3f);
      bytes[offset + 2] = 0x80 | ((point >> 6) & 0x3f);
      bytes[offset + 3] = 0x80 | (point & 0x3f);
      offset += 4;
    }
  }

  return bytes;
}

/** How many bytes {@link encodeUtf8} writes for `text`. */
function encodedLength(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    const point = codePointAt(text, index);
    if (point > 0xffff) index += 1;
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return length;
}

/** The code point starting at `index`, throwing on a lone surrogate. */
function codePointAt(text: string, index: number): number {
  const unit = text.charCodeAt(index);
  if (unit < 0xd800 || unit > 0xdfff) return unit;

  const next = text.charCodeAt(index + 1);
  if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
  }
  throw new RangeError(
    `A lone surrogate at code unit ${String(index)} has no UTF-8 form; write text through the canonical JSON writer, which escapes one.`,
  );
}

/** Why a byte sequence is not UTF-8, as the failure code says it. */
type Malformation =
  | 'utf8.unexpected-continuation-byte'
  | 'utf8.overlong-encoding'
  | 'utf8.surrogate-code-point'
  | 'utf8.beyond-unicode'
  | 'utf8.invalid-continuation-byte'
  | 'utf8.truncated-sequence';

/** What each malformation means, for the failure's summary. */
const MALFORMATION_SUMMARY: Readonly<Record<Malformation, string>> = {
  'utf8.unexpected-continuation-byte': 'A continuation byte stands where a character should begin.',
  'utf8.overlong-encoding': 'A character is written in more bytes than UTF-8 allows for it.',
  'utf8.surrogate-code-point': 'A UTF-16 surrogate is written as a character, which UTF-8 forbids.',
  'utf8.beyond-unicode': 'A character lies beyond the last Unicode code point.',
  'utf8.invalid-continuation-byte':
    'A multi-byte character is interrupted by a byte that does not continue it.',
  'utf8.truncated-sequence': 'The bytes end in the middle of a character.',
};

/**
 * Decodes UTF-8, refusing anything that is not well formed.
 *
 * Refused: a continuation byte where a character begins, an overlong form, an
 * encoded surrogate, a code point past U+10FFFF, an interrupted sequence and a
 * truncated one. A byte order mark is decoded as the character it is; whether a
 * format tolerates one is that format's decision.
 */
export function decodeUtf8(bytes: Uint8Array): DomainResult<string> {
  let text = '';
  const units: number[] = [];

  let offset = 0;
  while (offset < bytes.length) {
    const decoded = decodeOne(bytes, offset);
    if (typeof decoded === 'string') {
      return fail(
        failure(decoded, FailureKind.IntegrityViolation, MALFORMATION_SUMMARY[decoded], {
          details: { offset },
        }),
      );
    }

    const [point, length] = decoded;
    if (point > 0xffff) {
      units.push(0xd800 + ((point - 0x10000) >> 10), 0xdc00 + ((point - 0x10000) & 0x3ff));
    } else {
      units.push(point);
    }
    offset += length;

    if (units.length >= UNITS_PER_FLUSH) {
      text += String.fromCharCode(...units);
      units.length = 0;
    }
  }

  return succeed(text + String.fromCharCode(...units));
}

/**
 * The code point starting at `offset` and how many bytes it took, or why the
 * bytes there are not UTF-8. The ranges are those of RFC 3629, section 4.
 */
function decodeOne(
  bytes: Uint8Array,
  offset: number,
): readonly [point: number, length: number] | Malformation {
  const lead = byteAt(bytes, offset);
  if (lead < 0x80) return [lead, 1];
  if (lead < 0xc0) return 'utf8.unexpected-continuation-byte';
  if (lead < 0xc2) return 'utf8.overlong-encoding';
  if (lead > 0xf4) return 'utf8.beyond-unicode';

  const length = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
  if (offset + length > bytes.length) return 'utf8.truncated-sequence';

  // The second byte's range is where the lead alone cannot rule out an
  // overlong form, a surrogate or a point past the last one.
  const second = byteAt(bytes, offset + 1);
  if (second < 0x80 || second > 0xbf) return 'utf8.invalid-continuation-byte';
  if (lead === 0xe0 && second < 0xa0) return 'utf8.overlong-encoding';
  if (lead === 0xed && second > 0x9f) return 'utf8.surrogate-code-point';
  if (lead === 0xf0 && second < 0x90) return 'utf8.overlong-encoding';
  if (lead === 0xf4 && second > 0x8f) return 'utf8.beyond-unicode';

  let point = lead & (length === 2 ? 0x1f : length === 3 ? 0x0f : 0x07);
  point = (point << 6) | (second & 0x3f);
  for (let index = 2; index < length; index += 1) {
    const next = byteAt(bytes, offset + index);
    if (next < 0x80 || next > 0xbf) return 'utf8.invalid-continuation-byte';
    point = (point << 6) | (next & 0x3f);
  }
  return [point, length];
}

/** The byte at an offset the caller has already checked is inside `bytes`. */
function byteAt(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}
