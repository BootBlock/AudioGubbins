import { describe, expect, it } from 'vitest';

import { LONGEST_COST_TEST_MS, relativeCost } from '@audiogubbins/test-fixtures';

import { holderOf, identifierRule, namesHeldBy } from './holders.js';

/** A combining diaeresis, which a reader sees as part of the letter before it. */
const DIAERESIS = String.fromCodePoint(0x308);

/** A soft hyphen, which a reader never sees unless a line breaks at it. */
const SOFT_HYPHEN = String.fromCodePoint(0xad);

/** The identifier rule within 227 bytes, a bound a caller gives. */
const IDENTIFIERS = identifierRule(227);

/** Entries held under `ids`, each named after its identifier. */
function heldUnder(...ids: string[]): { id: string; displayName: string }[] {
  return ids.map((id) => ({ id, displayName: id }));
}

describe('the entry that holds a name', () => {
  const held = [
    { id: 'mine', displayName: 'Mine' },
    { id: 'motley', displayName: 'Mötley' },
  ];

  it('is the one whose name a reader hears as the name, compared as names are', () => {
    expect(holderOf(held, '  MINE ')).toBe(held[0]);
    expect(holderOf(held, `Mo${DIAERESIS}tley`)).toBe(held[1]);
    expect(holderOf(held, 'Motley')).toBeUndefined();
  });

  it('is never the entry the name is being given to', () => {
    expect(holderOf(held, 'Mine', 'mine')).toBeUndefined();
    expect(holderOf(held, 'Mine', 'motley')).toBe(held[0]);
  });
});

describe('the names a list holds, asked of many times', () => {
  const held = [
    { id: 'mine', displayName: 'Mine' },
    { id: 'motley', displayName: 'Mötley' },
    { id: 'desk', displayName: 'Mixing  desk ' },
    { id: 'mine-2', displayName: 'MINE' },
  ];

  it('answers each name as the entry that holds it, as one question of the list does', () => {
    const names = namesHeldBy(held);
    const asked = [
      '  MINE ',
      `Mo${DIAERESIS}tley`,
      'Motley',
      'mixing desk',
      'Mixingdesk',
      'Mixing-desk',
      '',
      'Zebra',
      'Aardvark',
    ];

    for (const name of asked) {
      expect(names.holderOf(name), name).toBe(holderOf(held, name));
      expect(names.taken(name), name).toBe(holderOf(held, name) !== undefined);
    }
    // Of two entries of one name, the first given.
    expect(names.holderOf('mine')).toBe(held[0]);
  });

  it('never holds the name of the entry it is built for', () => {
    const names = namesHeldBy(held, 'mine');

    expect(names.holderOf('Mine')).toBe(held[3]);
    expect(namesHeldBy(held.slice(0, 2), 'mine').taken('Mine')).toBe(false);
  });

  it('holds a name taken where it differs only in a code point the comparison ignores', () => {
    // Keyed by a folding of the text, "Mix 3" and a stored "Mix\u00AD 3" are
    // two names, where a reader sees one.
    const names = namesHeldBy([
      { id: 'mix', displayName: 'Mix' },
      { id: 'mix-3', displayName: `Mix${SOFT_HYPHEN} 3` },
    ]);

    expect(names.taken('Mix 3')).toBe(true);
    expect(names.taken('mix 3')).toBe(true);
    expect(names.taken('Mix 2')).toBe(false);
  });
});

describe('the identifier free of those in use', () => {
  it('is the derived one where nothing holds it', () => {
    expect(
      IDENTIFIERS.identifiersHeldBy(heldUnder('default', 'mixing'), 'profile').forName('Mastering'),
    ).toBe('mastering');
  });

  it('takes the first free number from two where the derived one is held', () => {
    // An identifier a thing is held under is where storage keeps it, so one
    // given twice writes a second thing over the first.
    expect(
      IDENTIFIERS.identifiersHeldBy(heldUnder('recording'), 'workspace').forName('Recording!'),
    ).toBe('recording-2');
    expect(IDENTIFIERS.identifiersHeldBy(heldUnder('default'), 'profile').forName('Default')).toBe(
      'default-2',
    );
    expect(
      IDENTIFIERS.identifiersHeldBy(heldUnder('editing'), 'workspace').forName('editing'),
    ).toBe('editing-2');
    expect(
      IDENTIFIERS.identifiersHeldBy(
        heldUnder('default', 'mastering', 'mastering-2'),
        'profile',
      ).forName('Mastering!'),
    ).toBe('mastering-3');
  });

  it('numbers the one a caller gives, where the name leaves nothing and that is held', () => {
    expect(IDENTIFIERS.identifiersHeldBy(heldUnder('workspace'), 'workspace').forName('***')).toBe(
      'workspace-2',
    );
  });

  it('is held once given, so the next one given is another, and the first gap is filled first', () => {
    const identifiers = IDENTIFIERS.identifiersHeldBy(heldUnder('mix', 'mix-3'), 'workspace');

    expect([1, 2, 3].map(() => identifiers.forName('Mix'))).toEqual(['mix-2', 'mix-4', 'mix-5']);
    expect(identifiers.forName('Mix 2')).toBe('mix-2-2');
  });

  it('keeps a stored identifier where it is free, and numbers one another holds from it', () => {
    const identifiers = IDENTIFIERS.identifiersHeldBy(heldUnder('default'), 'profile');

    expect(identifiers.forStored('mine')).toBe('mine');
    expect(identifiers.forStored('mine')).toBe('mine-2');
    expect(identifiers.forStored('default')).toBe('default-2');
  });

  it('refuses a stored identifier out of the shape one is derived in, and holds nothing for it', () => {
    // Kept as stored, it would be where storage keeps the entry and the words
    // of a message; renamed, the entry would be one the user never saw stored.
    const identifiers = IDENTIFIERS.identifiersHeldBy(heldUnder('default'), 'profile');
    const outOfShape = ['***', '', 'a/b', 'a\nb', '-a', 'a--b', 'Mine', 'x'.repeat(1_000_000)];

    for (const id of [...outOfShape, 'con', String.fromCodePoint(0x1160)]) {
      expect(identifiers.forStored(id)).toBeUndefined();
    }
    expect(identifiers.forName('***')).toBe('profile');
    expect(identifiers.forName('A--B')).toBe('a-b');
  });

  it('numbers a long identifier within the bound, where the one derived is held', () => {
    const long = 'ж'.repeat(113);
    const identifiers = IDENTIFIERS.identifiersHeldBy(heldUnder(long), 'profile');

    const numbered = identifiers.forStored(long);
    expect(numbered).toBe(`${'ж'.repeat(112)}-2`);
    expect(identifiers.forName(long.toUpperCase())).toBe(`${'ж'.repeat(112)}-3`);
  });
});

describe('identifiers given under one derived identifier', () => {
  /** `count` identifiers given for entries stored under `twin`, in turn. */
  const given = (count: number): (string | undefined)[] => {
    const identifiers = IDENTIFIERS.identifiersHeldBy(heldUnder('twin'), 'profile');
    return Array.from({ length: count }, () => identifiers.forStored('twin'));
  };

  it(
    'cost in proportion to their number, not its square',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // Counted from two for each, the thousandth of a thousand stored under
      // one identifier would read a thousand held, and a stored list of
      // thousands would hold the start for as long as it took to count them
      // all. Held by the processor time, so no way of holding them escapes it:
      // four times as many cost about three to five and a half times as much,
      // under load, about thirteen times with those held searched one by one,
      // and some sixteen with the count started from two. That last takes
      // seconds a reading, within the time a test of cost is allowed.
      const thousand = given(1000);
      expect(thousand[0]).toBe('twin-2');
      expect(thousand.at(-1)).toBe('twin-1001');
      expect(new Set(thousand).size).toBe(1000);

      expect(
        relativeCost(
          () => given(8000),
          () => given(2000),
        ),
      ).toBeLessThan(7);
    },
  );
});
