import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  canonicalJson,
  canonicalJsonWithin,
  compareCodeUnits,
  isJsonArray,
  isJsonObject,
  memberOf,
  prettyCanonicalJson,
  prettyCanonicalJsonWithin,
  type JsonValue,
} from './canonical-json.js';
import { parseJson } from './json-parsing.js';
import { seededRandom, type Random } from './testing/random-values.js';

const LIMITS = { maximumLength: 1_000_000, maximumDepth: 64 };

/** A random JSON value, its objects built with their members in random order. */
function randomValue(random: Random, depth: number): JsonValue {
  const kind = depth > 3 ? random.below(4) : random.below(6);
  switch (kind) {
    case 0:
      return null;
    case 1:
      return random.chance(0.5);
    case 2:
      return random.pick([0, -1, 1.5, 1e21, -2e-7, 5e-324, Number.MAX_VALUE, 2 ** 53 - 1]);
    case 3:
      return random.pick([
        '',
        'plain',
        'é中🎵',
        'quote " and \\',
        'line\nbreak\u0001',
        '\ud800lone',
        ' ',
      ]);
    case 4:
      return Array.from({ length: random.below(4) }, () => randomValue(random, depth + 1));
    default: {
      const keys = ['b', 'a', '10', '9', 'B', 'é', '__proto__', 'constructor', ''];
      const entries = keys
        .filter(() => random.chance(0.5))
        .map((key) => [key, randomValue(random, depth + 1)] as const);
      return Object.fromEntries(random.chance(0.5) ? entries : entries.reverse());
    }
  }
}

/** The same value with every object's members inserted in reverse order. */
function reversedMembers(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(reversedMembers);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((key) => [key, reversedMembers(memberOf(value, key) ?? null)]),
    );
  }
  return value;
}

describe('canonicalJson', () => {
  it('writes members sorted by code unit, including keys that look like indices', () => {
    const value = { b: 1, a: 2, '10': 3, '9': 4, B: 5, é: 6, '': 7 };
    expect(canonicalJson(value)).toBe('{"":7,"10":3,"9":4,"B":5,"a":2,"b":1,"é":6}');
  });

  it('writes the same text whatever order the members were built in', () => {
    const random = seededRandom(11);
    for (let trial = 0; trial < 300; trial += 1) {
      const value = randomValue(random, 0);
      expect(canonicalJson(reversedMembers(value))).toBe(canonicalJson(value));
      expect(prettyCanonicalJson(reversedMembers(value))).toBe(prettyCanonicalJson(value));
    }
  });

  it('reads back as the same value, and writes the same text again', () => {
    const random = seededRandom(12);
    for (let trial = 0; trial < 300; trial += 1) {
      const value = randomValue(random, 0);
      const text = canonicalJson(value);
      const read = expectSuccess(parseJson(text, LIMITS));
      expect(read).toEqual(value);
      expect(canonicalJson(read)).toBe(text);
      expect(expectSuccess(parseJson(prettyCanonicalJson(value), LIMITS))).toEqual(value);
    }
  });

  it('agrees with JSON.parse on what every text it writes means', () => {
    const random = seededRandom(13);
    for (let trial = 0; trial < 300; trial += 1) {
      const value = randomValue(random, 0);
      expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
    }
  });

  it('escapes as JSON requires, with a lone surrogate escaped and a pair kept', () => {
    expect(canonicalJson('"\\\b\f\n\r\t\u0001\u001f')).toBe(
      String.raw`"\"\\\b\f\n\r\t\u0001\u001f"`,
    );
    expect(canonicalJson('a\ud800b\udc00')).toBe(String.raw`"a\ud800b\udc00"`);
    expect(canonicalJson('🎵 é')).toBe('"🎵 é"');
  });

  it('writes negative zero as zero and every other number in its shortest form', () => {
    expect(canonicalJson([-0, 0.1, 1e21, 1e-7, 100])).toBe('[0,0.1,1e+21,1e-7,100]');
  });

  it('throws on a number JSON cannot hold, rather than writing null', () => {
    expect(() => canonicalJson({ gain: Number.NaN })).toThrow(RangeError);
    expect(() => canonicalJson([Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });

  it('writes a key such as __proto__ as the member it is', () => {
    const value = JSON.parse('{"__proto__":{"x":1},"a":[]}') as JsonValue;
    expect(canonicalJson(value)).toBe('{"__proto__":{"x":1},"a":[]}');
  });
});

describe('prettyCanonicalJson', () => {
  it('lays out one member or item a line, two spaces a level, and ends with a newline', () => {
    const value = { name: 'Walk', tags: ['a', 'b'], loop: { start: 1 }, empty: [], none: {} };
    expect(prettyCanonicalJson(value)).toBe(
      [
        '{',
        '  "empty": [],',
        '  "loop": {',
        '    "start": 1',
        '  },',
        '  "name": "Walk",',
        '  "none": {},',
        '  "tags": [',
        '    "a",',
        '    "b"',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('lays out a scalar on its own line', () => {
    expect(prettyCanonicalJson('text')).toBe('"text"\n');
  });
});

describe('canonicalJsonWithin and prettyCanonicalJsonWithin', () => {
  it('write exactly the texts a reader with the same limits reads back', () => {
    const random = seededRandom(0x5eed_b0);
    for (let run = 0; run < 2_000; run += 1) {
      const value = randomValue(random, 0);
      for (const [within, whole] of [
        [canonicalJsonWithin, canonicalJson],
        [prettyCanonicalJsonWithin, prettyCanonicalJson],
      ] as const) {
        const text = whole(value);
        const limits = {
          maximumLength: text.length - 2 + random.below(5),
          maximumDepth: 1 + random.below(6),
        };
        const written = within(value, limits);
        expect(written.ok).toBe(parseJson(text, limits).ok);
        if (written.ok) expect(written.value).toBe(text);
      }
    }
  });

  it('refuse one code unit past the length a reader accepts, as that reader does', () => {
    const value = { name: 'Walk', tags: ['a', 'b'] };
    const length = canonicalJson(value).length;
    expect(
      expectSuccess(canonicalJsonWithin(value, { maximumLength: length, maximumDepth: 2 })),
    ).toBe(canonicalJson(value));
    expect(
      expectFailureCode(canonicalJsonWithin(value, { maximumLength: length - 1, maximumDepth: 2 })),
    ).toBe('json.too-long');
  });

  it('refuse one level deeper than a reader accepts, as that reader does', () => {
    const value = { outer: [{ inner: [] }] };
    expect(expectSuccess(canonicalJsonWithin(value, { maximumLength: 100, maximumDepth: 4 }))).toBe(
      '{"outer":[{"inner":[]}]}',
    );
    expect(
      expectFailureCode(canonicalJsonWithin(value, { maximumLength: 100, maximumDepth: 3 })),
    ).toBe('json.too-deep');
    expect(
      expectFailureCode(prettyCanonicalJsonWithin(value, { maximumLength: 100, maximumDepth: 3 })),
    ).toBe('json.too-deep');
  });

  it('stop at the bound rather than build a text too long for the runtime to hold', () => {
    const chunk = 'x'.repeat(2 ** 20);
    const value = Array.from({ length: 600 }, () => chunk);
    expect(() => canonicalJson(value)).toThrow(RangeError);
    expect(
      expectFailureCode(canonicalJsonWithin(value, { maximumLength: 2 ** 28, maximumDepth: 1 })),
    ).toBe('json.too-long');
  });
});

describe('compareCodeUnits', () => {
  it('orders by UTF-16 code unit, not by locale or code point', () => {
    expect(['é', 'z', 'Z', '￿', '🎵'].sort(compareCodeUnits)).toEqual(['Z', 'z', 'é', '🎵', '￿']);
  });
});
