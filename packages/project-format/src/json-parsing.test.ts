import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { memberOf, isJsonObject } from './canonical-json.js';
import { parseJson } from './json-parsing.js';

const LIMITS = { maximumLength: 10_000, maximumDepth: 8 };

describe('parseJson', () => {
  it('reads every kind of value', () => {
    expect(
      expectSuccess(
        parseJson(
          ' { "a" : [ 1 , -2.5e3 , 0.25E-2 , true , false , null ] ,\n\t"b" : "x\\u00e9\\ud83c\\udfb5\\/\\"" } \r\n',
          LIMITS,
        ),
      ),
    ).toEqual({ a: [1, -2500, 0.0025, true, false, null], b: 'xé🎵/"' });
  });

  it('keeps a lone surrogate written as an escape', () => {
    expect(expectSuccess(parseJson(String.raw`"\ud800"`, LIMITS))).toBe('\ud800');
  });

  it('skips one byte order mark at the start, as RFC 8259 allows', () => {
    expect(expectSuccess(parseJson('﻿{"a":1}', LIMITS))).toEqual({ a: 1 });
    expect(expectFailureCode(parseJson('﻿﻿{}', LIMITS))).toBe('json.unexpected-character');
  });

  it('reads a key such as __proto__ as a member of its own, not as a prototype', () => {
    const value = expectSuccess(
      parseJson('{"__proto__":{"polluted":true},"constructor":1}', LIMITS),
    );
    expect(isJsonObject(value)).toBe(true);
    if (!isJsonObject(value)) return;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(memberOf(value, '__proto__')).toEqual({ polluted: true });
    expect(memberOf(value, 'constructor')).toBe(1);
    expect(memberOf(value, 'toString')).toBeUndefined();
  });

  it('reads nesting up to the depth limit and refuses one level more', () => {
    const nested = (depth: number): string => '['.repeat(depth) + ']'.repeat(depth);
    expect(parseJson(nested(8), LIMITS).ok).toBe(true);
    expect(expectFailureCode(parseJson(nested(9), LIMITS))).toBe('json.too-deep');
  });

  it('refuses a hostile depth without exhausting the stack', () => {
    const text = '['.repeat(100_000);
    expect(expectFailureCode(parseJson(text, { maximumLength: 200_000, maximumDepth: 512 }))).toBe(
      'json.too-deep',
    );
  });

  it('throws on a depth limit the parser cannot honour, which is a programmer error', () => {
    expect(() => parseJson('1', { maximumLength: 10, maximumDepth: 513 })).toThrow(RangeError);
    expect(() => parseJson('1', { maximumLength: 10, maximumDepth: 0 })).toThrow(RangeError);
  });

  it.each([
    ['text past the length limit', 'x'.repeat(10_001), 'json.too-long'],
    ['a character JSON does not allow', '{"a":01}', 'json.unexpected-character'],
    ['a word that is not a literal', 'nul', 'json.unexpected-character'],
    ['a trailing comma', '[1,]', 'json.unexpected-character'],
    ['a single-quoted string', "{'a':1}", 'json.unexpected-character'],
    ['text that ends early', '{"a":', 'json.unexpected-end'],
    ['a string that never ends', '"abc', 'json.unexpected-end'],
    ['nothing at all', '   ', 'json.unexpected-end'],
    ['an unescaped control character', '"a\u0001b"', 'json.invalid-string'],
    ['an escape JSON does not define', String.raw`"\x41"`, 'json.invalid-string'],
    ['a short unicode escape', String.raw`"\u12"`, 'json.invalid-string'],
    ['a number with no digits', '-', 'json.invalid-number'],
    ['a number too large to be finite', '1e400', 'json.number-out-of-range'],
    ['a repeated member key', '{"a":1,"b":2,"a":3}', 'json.duplicate-key'],
    ['content after the document', '{} {}', 'json.trailing-content'],
  ])('refuses %s', (_case, text, code) => {
    const result = parseJson(text, LIMITS);
    expect(expectFailureCode(result)).toBe(code);
    expect(result.ok ? undefined : result.failures[0].kind).toBe('integrity-violation');
  });

  it('says where the problem is, and never quotes the text', () => {
    const result = parseJson('{"secret name":1,"secret name":2}', LIMITS);
    expect(result.ok ? undefined : result.failures[0].details).toEqual({ offset: 17 });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
