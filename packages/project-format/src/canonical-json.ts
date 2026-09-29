/**
 * The JSON value type and its one canonical text.
 *
 * REQ-STOR-026 asks for a documented, structured, Git-friendly format, and a
 * state is identified by the digest of its text (ADR-0020). Both need a value
 * to have exactly one text: members sorted, no insignificant choice left to the
 * writer. `JSON.stringify` cannot give that. It writes members in property
 * order, which puts every key that looks like an array index first whatever
 * order it was built in, and writes `NaN` as `null`, which reads back as a
 * different value.
 */

import { unsafeBrandId, type Branded } from '@audiogubbins/domain';

/** A JSON value. */
export type JsonValue = null | boolean | number | string | JsonArray | JsonObject;

/** A JSON array. */
export type JsonArray = readonly JsonValue[];

/**
 * A JSON object.
 *
 * Read a member with {@link memberOf}, never by indexing: a key such as
 * `constructor` would otherwise find what every object inherits.
 */
export type JsonObject = { readonly [member: string]: JsonValue };

/** Compact canonical JSON text, the form that is hashed. */
export type CanonicalJson = Branded<'CanonicalJson'>;

/** Whether a value is a JSON array. */
export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}

/** Whether a value is a JSON object. */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object's own member `key`, or `undefined` where it has none. */
export function memberOf(object: JsonObject, key: string): JsonValue | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/**
 * Orders two strings by UTF-16 code unit, the order members are written in.
 *
 * Neither locale-aware nor by code point, because the order has to be the same
 * on every machine and in every runtime, and the platform's own string
 * comparison is exactly this.
 */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The compact canonical text of a value: no whitespace, members sorted by
 * {@link compareCodeUnits}, arrays in order. Two equal values always give the
 * same text, so the text can be hashed.
 *
 * Throws a `RangeError` on a number that is not finite, which JSON cannot hold:
 * writing one would save a project that cannot be read back.
 */
export function canonicalJson(value: JsonValue): CanonicalJson {
  const parts: string[] = [];
  write(value, undefined, '', parts);
  return unsafeBrandId<'CanonicalJson'>(parts.join(''));
}

/**
 * The same canonical text laid out for people and for Git: two spaces of indent
 * per level, one member or item per line, LF line endings and a final newline.
 * Throws where {@link canonicalJson} throws.
 */
export function prettyCanonicalJson(value: JsonValue): string {
  const parts: string[] = [];
  write(value, '  ', '', parts);
  parts.push('\n');
  return parts.join('');
}

/**
 * Appends the text of `value` to `parts`. `indent` is the step of one level, or
 * `undefined` for the compact form; `margin` is the indent of the line the
 * value starts on.
 */
function write(
  value: JsonValue,
  indent: string | undefined,
  margin: string,
  parts: string[],
): void {
  if (value === null) {
    parts.push('null');
  } else if (typeof value === 'boolean') {
    parts.push(value ? 'true' : 'false');
  } else if (typeof value === 'number') {
    parts.push(numberText(value));
  } else if (typeof value === 'string') {
    parts.push(stringText(value));
  } else if (isJsonArray(value)) {
    writeContainer(
      value,
      (item) => {
        write(item, indent, inner(indent, margin), parts);
      },
      '[]',
      indent,
      margin,
      parts,
    );
  } else {
    const keys = Object.keys(value).sort(compareCodeUnits);
    const separator = indent === undefined ? ':' : ': ';
    writeContainer(
      keys,
      (key) => {
        parts.push(stringText(key), separator);
        write(memberOf(value, key) ?? null, indent, inner(indent, margin), parts);
      },
      '{}',
      indent,
      margin,
      parts,
    );
  }
}

/** The margin one level inside `margin`. */
function inner(indent: string | undefined, margin: string): string {
  return indent === undefined ? margin : margin + indent;
}

/** Writes an array or object's brackets around its items, laid out if indented. */
function writeContainer<TItem>(
  items: readonly TItem[],
  writeItem: (item: TItem) => void,
  brackets: '[]' | '{}',
  indent: string | undefined,
  margin: string,
  parts: string[],
): void {
  const [open, close] = brackets === '[]' ? ['[', ']'] : ['{', '}'];
  if (items.length === 0) {
    parts.push(open, close);
    return;
  }

  const lineStart = indent === undefined ? '' : `\n${margin}${indent}`;
  parts.push(open);
  items.forEach((item, index) => {
    if (index > 0) parts.push(',');
    parts.push(lineStart);
    writeItem(item);
  });
  parts.push(indent === undefined ? '' : `\n${margin}`, close);
}

/**
 * A finite number as JSON writes it: the shortest text that reads back as the
 * same double, which is what the language's own conversion produces, and 0 for
 * negative zero, which JSON cannot tell from zero.
 */
function numberText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`JSON has no form for ${String(value)}; a project value must be finite.`);
  }
  return String(value);
}

/**
 * Whether a string holds anything its text must escape: a quote, a backslash, a
 * control character or a surrogate. A surrogate pair is written as itself, and
 * the slower path that follows tells a pair from a lone half.
 */
function needsEscape(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x20 || unit === 0x22 || unit === 0x5c || (unit >= 0xd800 && unit <= 0xdfff)) {
      return true;
    }
  }
  return false;
}

/** The short escapes JSON defines, by code unit. */
const SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

/**
 * A string as canonical JSON writes it, in quotes.
 *
 * A control character takes its short escape where JSON has one and a
 * lower-case `\u00XX` otherwise. A lone surrogate is written as a lower-case
 * `\uXXXX` escape, so the text is always well-formed Unicode and encodes to
 * UTF-8, and the string reads back unit for unit. Everything else is written as
 * itself.
 */
function stringText(value: string): string {
  if (!needsEscape(value)) return `"${value}"`;

  let text = '"';
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    const short = SHORT_ESCAPES.get(unit);
    if (short !== undefined) {
      text += short;
    } else if (unit < 0x20) {
      text += `\\u${unit.toString(16).padStart(4, '0')}`;
    } else if (unit >= 0xd800 && unit <= 0xdbff && isLowSurrogate(value.charCodeAt(index + 1))) {
      text += value.slice(index, index + 2);
      index += 1;
    } else if (unit >= 0xd800 && unit <= 0xdfff) {
      text += `\\u${unit.toString(16)}`;
    } else {
      text += value[index] ?? '';
    }
  }
  return `${text}"`;
}

/** Whether a code unit is the second half of a surrogate pair. */
function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
