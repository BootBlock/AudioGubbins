/**
 * Reading JSON text into a {@link JsonValue}, within stated bounds.
 *
 * A project file is a trust boundary (REQ-EXEC-136.12): it may be torn, hand
 * edited, or written by another version. `JSON.parse` has no bound on depth, so
 * a hostile file overflows the stack, and it keeps the last of two members with
 * one key, so a hand edit that repeats a key silently loses the other value.
 * This parser bounds the text and its depth, refuses a repeated key, and
 * reports the first problem with its offset rather than throwing.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { JsonArray, JsonLimits, JsonObject, JsonValue } from './canonical-json.js';

/**
 * The deepest nesting any caller may ask for.
 *
 * Each level is a frame of this parser's recursion, so the bound is what keeps
 * a hostile file from reaching the engine's stack limit.
 */
const DEEPEST_ALLOWED = 512;

/** A number as JSON's grammar writes one (RFC 8259, section 6). */
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** Four hexadecimal digits of a `\u` escape. */
const HEX_FOUR = /[0-9a-fA-F]{4}/y;

/** What each single-character escape stands for. */
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);

/** The byte order mark, which RFC 8259 lets a reader ignore at the start. */
const BYTE_ORDER_MARK = '﻿';

/**
 * Parses JSON text.
 *
 * One byte order mark at the start is skipped, as RFC 8259 permits, because an
 * editor on Windows may add one to a file a person saved by hand. Every other
 * departure from the grammar is refused, as are a repeated member key, a number
 * too large to be finite, and anything past `limits`.
 */
export function parseJson(text: string, limits: JsonLimits): DomainResult<JsonValue> {
  if (
    !Number.isInteger(limits.maximumDepth) ||
    limits.maximumDepth < 1 ||
    limits.maximumDepth > DEEPEST_ALLOWED
  ) {
    throw new RangeError(
      `A JSON depth limit is a whole number from 1 to ${String(DEEPEST_ALLOWED)}.`,
    );
  }
  if (text.length > limits.maximumLength) {
    return fail(
      failure(
        'json.too-long',
        FailureKind.IntegrityViolation,
        'The text is longer than this document may be.',
        {
          details: { length: text.length, maximum: limits.maximumLength },
        },
      ),
    );
  }

  const parser = new Parser(text, limits.maximumDepth);
  const value = parser.document();
  if (value !== undefined) return succeed(value);
  if (parser.problem === undefined) {
    throw new Error('The JSON parser stopped without recording why.');
  }
  return fail(parser.problem);
}

/**
 * One pass over one text. A method returns `undefined` once it has recorded a
 * problem, which every caller passes straight up, so the first problem found is
 * the one reported.
 */
class Parser {
  private readonly text: string;
  private readonly maximumDepth: number;

  /** Where reading has reached, in code units. */
  private offset = 0;

  /** The first problem found. */
  problem: DomainFailure | undefined;

  constructor(text: string, maximumDepth: number) {
    this.text = text;
    this.maximumDepth = maximumDepth;
  }

  /** Reads the whole text as one value. */
  document(): JsonValue | undefined {
    if (this.text.startsWith(BYTE_ORDER_MARK)) this.offset = 1;
    const value = this.value(0);
    if (value === undefined) return undefined;
    this.skipWhitespace();
    if (this.offset < this.text.length) {
      this.refuse('json.trailing-content', 'Something follows the end of the value.');
      return undefined;
    }
    return value;
  }

  /** Records a problem at the current offset, unless one is recorded already. */
  private refuse(code: string, summary: string): void {
    this.problem ??= failure(code, FailureKind.IntegrityViolation, summary, {
      details: { offset: this.offset },
    });
  }

  private value(depth: number): JsonValue | undefined {
    this.skipWhitespace();
    const character = this.text[this.offset];
    switch (character) {
      case undefined:
        this.refuse('json.unexpected-end', 'The text ended where a value should be.');
        return undefined;
      case '{':
        return this.object(depth + 1);
      case '[':
        return this.array(depth + 1);
      case '"':
        return this.string();
      case 't':
        return this.literal('true', true);
      case 'f':
        return this.literal('false', false);
      case 'n':
        return this.literal('null', null);
      default:
        if (character === '-' || (character >= '0' && character <= '9')) return this.number();
        this.refuseUnexpected();
        return undefined;
    }
  }

  private object(depth: number): JsonObject | undefined {
    if (!this.within(depth)) return undefined;
    this.offset += 1;
    const entries: [string, JsonValue][] = [];
    const keys = new Set<string>();

    this.skipWhitespace();
    if (this.text[this.offset] === '}') {
      this.offset += 1;
      return {};
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.offset] !== '"') {
        this.refuseUnexpected();
        return undefined;
      }
      const keyOffset = this.offset;
      const key = this.string();
      if (key === undefined) return undefined;
      if (keys.has(key)) {
        this.offset = keyOffset;
        this.refuse('json.duplicate-key', 'An object names the same member twice.');
        return undefined;
      }
      keys.add(key);

      this.skipWhitespace();
      if (this.text[this.offset] !== ':') {
        this.refuseUnexpected();
        return undefined;
      }
      this.offset += 1;
      const value = this.value(depth);
      if (value === undefined) return undefined;
      entries.push([key, value]);

      this.skipWhitespace();
      const next = this.text[this.offset];
      this.offset += 1;
      // `fromEntries` defines each member as the object's own, so a key such
      // as `__proto__` is a member like any other rather than a prototype.
      if (next === '}') return Object.fromEntries(entries);
      if (next !== ',') {
        this.offset -= 1;
        this.refuseUnexpected();
        return undefined;
      }
    }
  }

  private array(depth: number): JsonArray | undefined {
    if (!this.within(depth)) return undefined;
    this.offset += 1;
    const items: JsonValue[] = [];

    this.skipWhitespace();
    if (this.text[this.offset] === ']') {
      this.offset += 1;
      return items;
    }
    for (;;) {
      const value = this.value(depth);
      if (value === undefined) return undefined;
      items.push(value);

      this.skipWhitespace();
      const next = this.text[this.offset];
      this.offset += 1;
      if (next === ']') return items;
      if (next !== ',') {
        this.offset -= 1;
        this.refuseUnexpected();
        return undefined;
      }
    }
  }

  private string(): string | undefined {
    this.offset += 1;
    let value = '';
    for (;;) {
      const runEnd = this.plainRunEnd();
      value += this.text.slice(this.offset, runEnd);
      this.offset = runEnd;

      const character = this.text[this.offset];
      if (character === '"') {
        this.offset += 1;
        return value;
      }
      if (character === undefined) {
        this.refuse('json.unexpected-end', 'The text ended inside a string.');
        return undefined;
      }
      if (character !== '\\') {
        this.refuse(
          'json.invalid-string',
          'A string holds a control character that is not escaped.',
        );
        return undefined;
      }
      const escaped = this.escape();
      if (escaped === undefined) return undefined;
      value += escaped;
    }
  }

  /**
   * Where the run of string characters from the current offset ends: at a
   * quote, a backslash or a control character, each of which needs reading.
   */
  private plainRunEnd(): number {
    let end = this.offset;
    for (; end < this.text.length; end += 1) {
      const unit = this.text.charCodeAt(end);
      if (unit === 0x22 || unit === 0x5c || unit < 0x20) break;
    }
    return end;
  }

  /** Reads the escape at the current backslash. */
  private escape(): string | undefined {
    const letter = this.text[this.offset + 1] ?? '';
    const simple = ESCAPES.get(letter);
    if (simple !== undefined) {
      this.offset += 2;
      return simple;
    }
    if (letter === 'u') {
      HEX_FOUR.lastIndex = this.offset + 2;
      const digits = HEX_FOUR.exec(this.text)?.[0];
      if (digits !== undefined) {
        this.offset += 6;
        // A lone surrogate is kept as the unit it names: JSON allows one, and
        // the canonical writer escapes it again, so it reads back unchanged.
        return String.fromCharCode(Number.parseInt(digits, 16));
      }
    }
    this.refuse('json.invalid-string', 'A string holds an escape JSON does not define.');
    return undefined;
  }

  private number(): number | undefined {
    NUMBER.lastIndex = this.offset;
    const written = NUMBER.exec(this.text)?.[0];
    if (written === undefined) {
      this.refuse('json.invalid-number', 'A number is not written as JSON writes one.');
      return undefined;
    }
    const value = Number(written);
    if (!Number.isFinite(value)) {
      this.refuse('json.number-out-of-range', 'A number is too large to be held.');
      return undefined;
    }
    this.offset += written.length;
    return value;
  }

  private literal<TValue extends boolean | null>(word: string, value: TValue): TValue | undefined {
    if (!this.text.startsWith(word, this.offset)) {
      this.refuseUnexpected();
      return undefined;
    }
    this.offset += word.length;
    return value;
  }

  /** Whether a container opened at `depth` is within the depth limit. */
  private within(depth: number): boolean {
    if (depth <= this.maximumDepth) return true;
    this.refuse('json.too-deep', 'Arrays and objects are nested deeper than this document may be.');
    return false;
  }

  /** Refuses what stands at the current offset, or its absence. */
  private refuseUnexpected(): void {
    if (this.offset >= this.text.length) {
      this.refuse('json.unexpected-end', 'The text ended early.');
    } else {
      this.refuse('json.unexpected-character', 'A character stands where JSON does not allow it.');
    }
  }

  private skipWhitespace(): void {
    for (;;) {
      const character = this.text[this.offset];
      if (character !== ' ' && character !== '\t' && character !== '\n' && character !== '\r')
        return;
      this.offset += 1;
    }
  }
}
