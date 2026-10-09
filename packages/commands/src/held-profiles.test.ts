import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { keyPress } from '@audiogubbins/input';
import { N_LOG_N_FOURFOLD, comparisonsIn } from '@audiogubbins/test-fixtures';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { commandId } from './command.js';
import { profileName } from './profile-name.js';
import { duplicateProfile } from './profile-editing.js';
import { exportProfile, importProfile, restoreProfiles } from './shortcut-transfer.js';
import { shortcut, type ShortcutProfile } from './shortcut.js';

/**
 * What a profile is held under beside the others: an identifier allocated for
 * it, whether the profile is a copy, an import or one restored from storage,
 * and for a copy or an import, a name no other profile has.
 */

/** A profile, the user's unless said otherwise, binding Save to Ctrl+S. */
function profile(id: string, displayName: string, builtIn = false): ShortcutProfile {
  return {
    id,
    displayName,
    builtIn,
    bindings: [
      {
        commandId: commandId('file.save'),
        shortcut: shortcut(keyPress('KeyS', { control: true })),
      },
    ],
  };
}

/** A combining diaeresis, which a reader sees as part of the letter before it. */
const DIAERESIS = String.fromCodePoint(0x308);

/** The profile AudioGubbins ships, as the application holds it. */
const SHIPPED = profile('default', 'AudioGubbins default', true);

/** The text of a profile named `displayName`, as a file or storage holds it. */
function textNamed(displayName: string): string {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
    displayName,
    bindings: [{ command: 'file.save', presses: ['C+KeyS'] }],
  });
}

/** The profiles restored from `entries` beside the one AudioGubbins ships, in order. */
function restored(...entries: { id: string; text: string }[]): ShortcutProfile[] {
  return restoreProfiles(entries, SHIPPED).map((one) => expectSuccess(one.restored));
}

/** A soft hyphen, which a reader never sees unless a line breaks at it. */
const SOFT_HYPHEN = String.fromCodePoint(0xad);

/** A right-to-left override, which turns the text after it around. */
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);

/** The Hangul jungseong filler, a letter no reader sees. */
const JUNGSEONG_FILLER = String.fromCodePoint(0x1160);

describe('the identifier a profile is held under', () => {
  it('is allocated by the package, and never lands on a profile held, the built-in one included', () => {
    const held = [
      SHIPPED,
      profile('mastering', 'Mastering'),
      profile('mastering-2', 'Mastering 2'),
    ];

    expect(expectSuccess(importProfile(textNamed('Mastering!'), held)).profile.id).toBe(
      'mastering-3',
    );
    expect(expectSuccess(duplicateProfile(SHIPPED, held, 'Default')).id).toBe('default-2');
  });

  it('is derived from the name, readable where storage or a file name quotes it', () => {
    expect(expectSuccess(importProfile(textNamed("Jane's  Keys!"), [SHIPPED])).profile.id).toBe(
      'jane-s-keys',
    );
    expect(expectSuccess(duplicateProfile(SHIPPED, [SHIPPED], '***')).id).toBe('profile');
  });

  it("keeps a stored profile under its own identifier, or beside one that holds it, as the user's", () => {
    // Read under an identifier another profile holds, it took that profile's
    // place, or sat behind the built-in one where it could be neither switched
    // to nor deleted.
    const [mine, theirs, underTheBuiltIn] = restored(
      { id: 'mine', text: textNamed('Mine') },
      { id: 'mine', text: textNamed('Theirs') },
      { id: 'default', text: textNamed('Mine') },
    );

    expect(mine?.id).toBe('mine');
    expect(theirs?.id).toBe('mine-2');
    expect(underTheBuiltIn?.id).toBe('default-2');
    expect(underTheBuiltIn?.builtIn).toBe(false);
  });
});

describe('a stored list of profiles', () => {
  it('is restored whole, each entry numbered apart from those before it and the one shipped', () => {
    // One list at once, so the identifiers held are gathered once for it and
    // no caller can gather them again for each entry.
    const ids = restored(
      { id: 'twin', text: textNamed('One') },
      { id: 'twin', text: textNamed('Two') },
      { id: 'default', text: textNamed('Three') },
    ).map((one) => one.id);

    expect(ids).toEqual(['twin', 'twin-2', 'default-2']);
  });

  it('answers an entry it cannot read in its place, holding no identifier for it', () => {
    const answers = restoreProfiles(
      [
        { id: 'twin', text: 'not a profile' },
        { id: 'twin', text: textNamed('Two') },
      ],
      SHIPPED,
    ).map((one) => (one.restored.ok ? one.restored.value.id : expectFailureCode(one.restored)));

    expect(answers).toEqual(['shortcut-profile.not-json', 'twin']);
  });

  it('refuses in its place an entry stored under an identifier out of shape, quoting none of it', () => {
    // Kept as stored, an identifier of any length and any characters would be
    // the name of the exported file and the words of the announcement.
    const outOfShape = [
      '',
      `a${RIGHT_TO_LEFT_OVERRIDE}gnp.exe`,
      'x'.repeat(1_000_000),
      'a/b',
      'a\nb',
      '-a',
      'a--b',
    ];
    const entries = [...outOfShape, 'kept'].map((id) => ({ id, text: textNamed('Mine') }));
    const answers = restoreProfiles(entries, SHIPPED).map((one) => one.restored);

    for (const answer of answers.slice(0, -1)) {
      expect(expectFailureCode(answer)).toBe('shortcut-profile.identifier-out-of-shape');
      expect(answer.ok ? '' : answer.failures[0].summary).toBe(
        'That profile is stored under an identifier AudioGubbins does not give.',
      );
    }
    expect(answers.map((answer) => (answer.ok ? answer.value.id : undefined)).at(-1)).toBe('kept');
  });

  it('refuses in its place an entry stored under a device name Windows reserves, or a letter a reader cannot see', () => {
    // Kept, the first is the name of a file the browser saves under another
    // name, and the second of one whose name reads as nothing.
    const ids = ['con', 'com1', JUNGSEONG_FILLER, `a${JUNGSEONG_FILLER}b`, 'con-2'];
    const answers = restoreProfiles(
      ids.map((id) => ({ id, text: textNamed('Mine') })),
      SHIPPED,
    ).map(({ restored }) => (restored.ok ? restored.value.id : expectFailureCode(restored)));

    expect(answers).toEqual([
      'shortcut-profile.identifier-out-of-shape',
      'shortcut-profile.identifier-out-of-shape',
      'shortcut-profile.identifier-out-of-shape',
      'shortcut-profile.identifier-out-of-shape',
      'con-2',
    ]);
  });

  it('says both where an entry out of shape cannot be read either', () => {
    const codes = restoreProfiles([{ id: 'a/b', text: 'not a profile' }], SHIPPED).map(
      ({ restored }) => (restored.ok ? [] : restored.failures.map((one) => one.code)),
    );

    expect(codes).toEqual([
      ['shortcut-profile.identifier-out-of-shape', 'shortcut-profile.not-json'],
    ]);
  });
});

describe('a name another profile has', () => {
  const mine = profile('mine', 'Mine');
  const held = [SHIPPED, mine, profile('motley', 'Mötley')];

  /** The name a profile imported from `text` beside `held` is given. */
  const importedAs = (text: string): string =>
    expectSuccess(importProfile(text, held)).profile.displayName;

  it('is refused where a copy is given it, and numbered where an import carries it, compared as a reader hears it', () => {
    // Two profiles of one name are two entries the settings list and "The …
    // shortcuts are in force" cannot tell apart. A name typed for a copy can
    // be typed again; the name in a file is not the reader's to choose.
    expect(expectFailureCode(duplicateProfile(SHIPPED, held, ' MINE '))).toBe(
      'shortcut-profile.name-in-use',
    );
    expect(expectFailureCode(duplicateProfile(SHIPPED, held, `Mo${DIAERESIS}tley`))).toBe(
      'shortcut-profile.name-in-use',
    );
    expect(importedAs(textNamed('mine'))).toBe('mine 2');
    expect(importedAs(textNamed(`Mo${DIAERESIS}tley`))).toBe(`Mo${DIAERESIS}tley 2`);
    expect(importedAs(textNamed('Theirs'))).toBe('Theirs');
  });

  it('is numbered where a profile exported here is imported here, the built-in one included', () => {
    // Refused, a profile carried back to the machine it was exported on could
    // be imported only by editing the file.
    expect(importedAs(exportProfile(mine))).toBe('Mine 2');
    expect(importedAs(exportProfile(SHIPPED))).toBe('AudioGubbins default 2');
  });

  it('is numbered past every number another profile has, under an identifier of its own', () => {
    const numbered = [...held, profile('mine-2', 'MINE 2')];
    const imported = expectSuccess(importProfile(textNamed('Mine'), numbered)).profile;

    expect(imported.displayName).toBe('Mine 3');
    expect(imported.id).toBe('mine-3');
  });

  /** The built-in profile, then "X", then "X 2" to "X <count>", each the user's. */
  const numberedNames = (count: number): ShortcutProfile[] => [
    SHIPPED,
    ...Array.from({ length: count }, (_, index) =>
      index === 0 ? profile('x', 'X') : profile(`x-${String(index + 1)}`, `X ${String(index + 1)}`),
    ),
  ];

  it('is numbered past every name of its own held, one that differs by a soft hyphen among them', () => {
    expect(
      expectSuccess(importProfile(textNamed('X'), numberedNames(40))).profile.displayName,
    ).toBe('X 41');

    // Keyed by a folding of the text, the held "X\u00AD 3" is not "X 3".
    const softly = [...numberedNames(2), profile('x-3', `X${SOFT_HYPHEN} 3`)];
    expect(expectSuccess(importProfile(textNamed('X'), softly)).profile.displayName).toBe('X 4');
  });

  it('is numbered past thousands of names of its own held, in comparisons that grow slower than n log² n', () => {
    // Asked of every profile held for each number, an import of "X" beside "X"
    // to "X n" takes about n squared comparisons. Counted, not timed: four
    // times the names may cost 5.5 times the comparisons, above the 4.8 of work
    // that grows as n log n and under the 5.8 of n log² n, and a count past
    // that is stopped there.
    const comparisonsFor = (count: number, ceiling?: number): number => {
      const held = numberedNames(count);
      let imported = '';
      const counted = comparisonsIn(() => {
        imported = expectSuccess(importProfile(textNamed('X'), held)).profile.displayName;
      }, ceiling);
      expect(imported).toBe(`X ${String(count + 1)}`);
      return counted;
    };

    const thousand = comparisonsFor(1000);
    expect(comparisonsFor(4000, N_LOG_N_FOURFOLD * thousand) / thousand).toBeLessThan(
      N_LOG_N_FOURFOLD,
    );
  });

  it('is numbered within the bound a name is held to, however long the name imported', () => {
    // Cut at a word, in characters, so the number is not refused as a name
    // too long, over a name the reader never typed.
    const long = `${'word '.repeat(23)}words`;
    const withLong = [...held, profile('long', long)];
    const imported = expectSuccess(importProfile(textNamed(long), withLong)).profile.displayName;

    expect(imported).toBe(`${'word '.repeat(22)}word… 2`);
    expect(profileName(imported)).toBe(imported);
  });

  it('says which profile has a name typed for a copy, and which an import is numbered apart from', () => {
    const summaryOf = (result: ReturnType<typeof duplicateProfile>): string | undefined =>
      result.ok ? undefined : result.failures[0].summary;

    expect(summaryOf(duplicateProfile(SHIPPED, held, 'mine'))).toBe(
      'There is already a profile called “Mine”. Choose another name.',
    );
    expect(expectSuccess(importProfile(textNamed('mine'), held)).namesake).toBe(mine);
    expect(expectSuccess(importProfile(textNamed('Theirs'), held)).namesake).toBeUndefined();
  });

  it('is held to no stored profile, whose name is its own however the others are named', () => {
    // Stored work is never refused for a name another profile has: two stored
    // profiles of one name both load.
    const [mine, twin] = restored(
      { id: 'mine', text: textNamed('Mine') },
      { id: 'twin', text: textNamed('Mine') },
    );

    expect(mine?.displayName).toBe('Mine');
    expect(twin?.displayName).toBe('Mine');
    expect(twin?.id).toBe('twin');
  });

  it('is compared and numbered without the space typed or carried around it', () => {
    expect(expectFailureCode(duplicateProfile(SHIPPED, held, 'Mine '))).toBe(
      'shortcut-profile.name-in-use',
    );
    expect(expectSuccess(duplicateProfile(SHIPPED, held, '  Theirs ')).displayName).toBe('Theirs');
    expect(importedAs(textNamed('Mine '))).toBe('Mine 2');
    expect(importedAs(textNamed(' Theirs\t'))).toBe('Theirs');
  });

  it('is read from storage as it is stored, space around it and all', () => {
    const [stored] = restored({ id: 'spaced', text: textNamed(' Mine ') });

    expect(stored?.displayName).toBe(' Mine ');
  });
});

describe('a runtime that cannot compare names', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /**
   * The package's modules as they load on a runtime whose collation is Turkish
   * whatever a caller asks for, which cannot compare names by the one rule.
   */
  async function whereNamesCannotBeCompared() {
    const RealCollator = Intl.Collator;
    vi.spyOn(Intl, 'Collator').mockImplementation(
      class extends RealCollator {
        constructor(_locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
          super('tr', options);
        }
      },
    );
    vi.resetModules();
    const [editing, transfer] = await Promise.all([
      import('./profile-editing.js'),
      import('./shortcut-transfer.js'),
    ]);
    return { ...editing, ...transfer };
  }

  it('restores every stored profile, each name as it is stored', async () => {
    const commands = await whereNamesCannotBeCompared();

    const read = commands
      .restoreProfiles(
        [
          { id: 'mine', text: textNamed('Mine') },
          { id: 'twin', text: textNamed('MINE') },
        ],
        SHIPPED,
      )
      .map((one) => expectSuccess(one.restored));

    expect(read.map((one) => [one.id, one.displayName])).toEqual([
      ['mine', 'Mine'],
      ['twin', 'MINE'],
    ]);
  });

  it('refuses in words to copy a profile, named or not, or to import one', async () => {
    const commands = await whereNamesCannotBeCompared();
    const refused = {
      code: 'shortcut-profile.names-cannot-be-compared',
      summary:
        'This browser cannot compare names as AudioGubbins does, so a profile cannot be copied, imported or named here.',
    };
    const firstFailure = (result: { ok: boolean; failures?: readonly unknown[] }): unknown =>
      result.failures?.[0];

    expect(firstFailure(commands.duplicateProfile(SHIPPED, [SHIPPED], 'Mine'))).toMatchObject(
      refused,
    );
    expect(firstFailure(commands.duplicateProfile(SHIPPED, [SHIPPED]))).toMatchObject(refused);
    expect(firstFailure(commands.importProfile(textNamed('Mine'), [SHIPPED]))).toMatchObject(
      refused,
    );
    // A file that cannot be read is refused for what the reader can put right.
    expect(expectFailureCode(commands.importProfile('not a profile', [SHIPPED]))).not.toBe(
      refused.code,
    );
  });
});

describe('the name of a copy nobody named', () => {
  it('is "My shortcuts" for a copy of the built-in profile, then the first free number', () => {
    const first = expectSuccess(duplicateProfile(SHIPPED, [SHIPPED]));
    const second = expectSuccess(duplicateProfile(SHIPPED, [SHIPPED, first]));
    const third = expectSuccess(duplicateProfile(SHIPPED, [SHIPPED, first, second]));

    expect([first, second, third].map((one) => one.displayName)).toEqual([
      'My shortcuts',
      'My shortcuts 2',
      'My shortcuts 3',
    ]);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it('is "<name> copy" for a copy of a profile the user made, then the first free number', () => {
    const mine = profile('mine', 'Mine');
    const first = expectSuccess(duplicateProfile(mine, [SHIPPED, mine]));
    const second = expectSuccess(duplicateProfile(mine, [SHIPPED, mine, first]));

    expect([first.displayName, second.displayName]).toEqual(['Mine copy', 'Mine copy 2']);
  });

  it('is numbered in the series of the name a copy is a copy of, for a copy of a copy', () => {
    // A copy of "Mine copy" was "Mine copy copy", a name that grew with each
    // copy of a copy.
    const mine = profile('mine', 'Mine');
    const copy = profile('mine-copy', 'Mine copy');
    const ofTheCopy = expectSuccess(duplicateProfile(copy, [SHIPPED, mine, copy]));
    expect(ofTheCopy.displayName).toBe('Mine copy 2');

    const later = expectSuccess(duplicateProfile(ofTheCopy, [SHIPPED, mine, copy, ofTheCopy]));
    expect(later.displayName).toBe('Mine copy 3');

    // "My shortcuts 2" is a name of its own, and a copy of its copy is in the
    // series of that copy.
    const numbered = profile('my-shortcuts-2', 'My shortcuts 2');
    const itsCopy = expectSuccess(duplicateProfile(numbered, [SHIPPED, numbered]));
    expect(itsCopy.displayName).toBe('My shortcuts 2 copy');
    expect(expectSuccess(duplicateProfile(itsCopy, [SHIPPED, numbered, itsCopy])).displayName).toBe(
      'My shortcuts 2 copy 2',
    );
  });

  it('is "<name> copy 2" for a copy of a name a reader hears as a copy\'s', () => {
    const mine = profile('mine', 'Mine');
    const heard = profile('mine-copy', 'Mine  COPY');

    expect(expectSuccess(duplicateProfile(heard, [SHIPPED, mine, heard])).displayName).toBe(
      'Mine copy 2',
    );
  });

  it('is named from the name copied without the space stored around it', () => {
    const spaced = profile('spaced', ' Mine ');

    expect(expectSuccess(duplicateProfile(spaced, [SHIPPED, spaced])).displayName).toBe(
      'Mine copy',
    );
  });

  it('is numbered past thousands of copies held, in comparisons that grow slower than n log² n', () => {
    // Asked of every profile held for each number, a copy of "Mine" beside
    // "Mine copy" to "Mine copy n" costs about n squared comparisons. Counted,
    // not timed: four times the copies may cost 5.5 times the comparisons,
    // above the 4.8 of n log n and under the 5.8 of n log² n, and a count past
    // that is stopped there.
    const comparisonsFor = (count: number, ceiling?: number): number => {
      const mine = profile('mine', 'Mine');
      const held = [
        SHIPPED,
        mine,
        ...Array.from({ length: count }, (_, index) =>
          profile(
            `mine-copy-${String(index + 1)}`,
            index === 0 ? 'Mine copy' : `Mine copy ${String(index + 1)}`,
          ),
        ),
      ];
      let named = '';
      const counted = comparisonsIn(() => {
        named = expectSuccess(duplicateProfile(mine, held)).displayName;
      }, ceiling);
      expect(named).toBe(`Mine copy ${String(count + 1)}`);
      return counted;
    };

    const thousand = comparisonsFor(1000);
    expect(comparisonsFor(4000, N_LOG_N_FOURFOLD * thousand) / thousand).toBeLessThan(
      N_LOG_N_FOURFOLD,
    );
  });

  it('is within the bound a name is held to, however long the name copied', () => {
    // Cut at a word, in characters, so what a copy adds is not refused as a
    // name too long, over a name the reader never typed.
    const long = profile('long', `${'word '.repeat(23)}end`);
    const copy = expectSuccess(duplicateProfile(long, [SHIPPED, long]));

    expect(copy.displayName).toBe(`${'word '.repeat(22)}word… copy`);
    expect(profileName(copy.displayName)).toBe(copy.displayName);
  });
});
