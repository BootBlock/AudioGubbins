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

import {
  FailureKind,
  fail,
  failure,
  mapResult,
  succeed,
  unsafeBrandId,
  type Branded,
  type DomainResult,
} from '@audiogubbins/domain';

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
 * The bounds a text is read and written within.
 *
 * A reader refuses a text past its bounds, so a writer that knows them refuses
 * to write one: a file written past them is one that can never be read back.
 */
export interface JsonLimits {
  /** The longest text, in UTF-16 code units. */
  readonly maximumLength: number;

  /** The deepest nesting of arrays and objects. */
  readonly maximumDepth: number;
}

const UNBOUNDED: JsonLimits = {
  maximumLength: Number.POSITIVE_INFINITY,
  maximumDepth: Number.POSITIVE_INFINITY,
};

/**
 * The compact canonical text of a value: no whitespace, members sorted by
 * {@link compareCodeUnits}, arrays in order. Two equal values always give the
 * same text, so the text can be hashed.
 *
 * Throws a `RangeError` on a number that is not finite, which JSON cannot hold:
 * writing one would save a project that cannot be read back.
 */
export function canonicalJson(value: JsonValue): CanonicalJson {
  return unsafeBrandId<'CanonicalJson'>(new TextWriter(undefined, UNBOUNDED).text(value));
}

/**
 * The same canonical text laid out for people and for Git: two spaces of indent
 * per level, one member or item per line, LF line endings and a final newline.
 * Throws where {@link canonicalJson} throws.
 */
export function prettyCanonicalJson(value: JsonValue): string {
  return new TextWriter('  ', UNBOUNDED).text(value);
}

/**
 * The compact canonical text of a value, where a reader bounded by `limits`
 * can read it back. Otherwise fails with the code that reader would give,
 * `json.too-long` or `json.too-deep`, having stopped writing at the bound
 * rather than built a text no one can read. Throws where
 * {@link canonicalJson} throws.
 */
export function canonicalJsonWithin(
  value: JsonValue,
  limits: JsonLimits,
): DomainResult<CanonicalJson> {
  return mapResult(textWithin(value, undefined, limits), (text) =>
    unsafeBrandId<'CanonicalJson'>(text),
  );
}

/**
 * {@link prettyCanonicalJson}'s text of a value, where a reader bounded by
 * `limits` can read it back, failing as {@link canonicalJsonWithin} does.
 */
export function prettyCanonicalJsonWithin(
  value: JsonValue,
  limits: JsonLimits,
): DomainResult<string> {
  return textWithin(value, '  ', limits);
}

function textWithin(
  value: JsonValue,
  indent: string | undefined,
  limits: JsonLimits,
): DomainResult<string> {
  const writer = new TextWriter(indent, limits);
  const text = writer.text(value);
  switch (writer.problem) {
    case undefined:
      return succeed(text);
    case 'too-long':
      return fail(
        failure(
          'json.too-long',
          FailureKind.IntegrityViolation,
          'The text would be longer than its reader accepts.',
          { details: { maximum: limits.maximumLength } },
        ),
      );
    case 'too-deep':
      return fail(
        failure(
          'json.too-deep',
          FailureKind.IntegrityViolation,
          'Arrays and objects would be nested deeper than their reader accepts.',
          { details: { maximum: limits.maximumDepth } },
        ),
      );
  }
}

/**
 * Writes one value's text, compact where `indent` is `undefined` and laid out
 * with that step per level otherwise, and stops at the first bound it passes.
 */
class TextWriter {
  /** The bound the text passed, where it passed one. */
  problem: 'too-long' | 'too-deep' | undefined;

  private readonly indent: string | undefined;
  private readonly limits: JsonLimits;
  private readonly parts: string[] = [];
  private length = 0;

  constructor(indent: string | undefined, limits: JsonLimits) {
    this.indent = indent;
    this.limits = limits;
  }

  /**
   * The text of `value`. Past a bound it is the empty text, with the bound in
   * {@link TextWriter.problem}, so a text too long to hold is never joined.
   */
  text(value: JsonValue): string {
    this.value(value, '', 0);
    if (this.indent !== undefined) this.push('\n');
    return this.problem === undefined ? this.parts.join('') : '';
  }

  /** Writes `value`, which starts on a line indented by `margin`, `depth` deep. */
  private value(value: JsonValue, margin: string, depth: number): void {
    if (this.problem !== undefined) return;
    if (value === null) {
      this.push('null');
    } else if (typeof value === 'boolean') {
      this.push(value ? 'true' : 'false');
    } else if (typeof value === 'number') {
      this.push(numberText(value));
    } else if (typeof value === 'string') {
      this.push(stringText(value));
    } else if (depth + 1 > this.limits.maximumDepth) {
      this.problem = 'too-deep';
    } else if (isJsonArray(value)) {
      this.container(value, '[]', margin, (item, inner) => {
        this.value(item, inner, depth + 1);
      });
    } else {
      const keys = Object.keys(value).sort(compareCodeUnits);
      const separator = this.indent === undefined ? ':' : ': ';
      this.container(keys, '{}', margin, (key, inner) => {
        this.push(stringText(key));
        this.push(separator);
        this.value(memberOf(value, key) ?? null, inner, depth + 1);
      });
    }
  }

  /** Writes an array or object's brackets around its items, laid out if indented. */
  private container<TItem>(
    items: readonly TItem[],
    brackets: '[]' | '{}',
    margin: string,
    writeItem: (item: TItem, inner: string) => void,
  ): void {
    const [open, close] = brackets === '[]' ? ['[', ']'] : ['{', '}'];
    if (items.length === 0) {
      this.push(open + close);
      return;
    }

    const inner = this.indent === undefined ? margin : margin + this.indent;
    const lineStart = this.indent === undefined ? '' : `\n${inner}`;
    this.push(open);
    for (const [index, item] of items.entries()) {
      if (this.problem !== undefined) return;
      if (index > 0) this.push(',');
      this.push(lineStart);
      writeItem(item, inner);
    }
    this.push(this.indent === undefined ? close : `\n${margin}${close}`);
  }

  private push(text: string): void {
    this.parts.push(text);
    this.length += text.length;
    if (this.length > this.limits.maximumLength) this.problem ??= 'too-long';
  }
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
