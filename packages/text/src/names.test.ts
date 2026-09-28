import { afterEach, describe, expect, it, vi } from 'vitest';

import { asName, asWrittenName, firstFreeCopyName, firstFreeName, sameName } from './names.js';

/** A combining diaeresis, which a reader sees as part of the letter before it. */
const DIAERESIS = String.fromCodePoint(0x308);

/** The Hangul filler, a letter no reader sees, which trimming a name leaves. */
const HANGUL_FILLER = String.fromCodePoint(0x3164);

/** The Hangul choseong filler, another letter no reader sees. */
const CHOSEONG_FILLER = String.fromCodePoint(0x115f);

describe('the shape of a name', () => {
  it('is the name itself where it has something in it and fits the bound', () => {
    expect(asName('Mixing', 120)).toBe('Mixing');
    expect(asName('😀'.repeat(120), 120)).toBe('😀'.repeat(120));
  });

  it('refuses a name of nothing but space as blank', () => {
    expect(asName('', 120)).toEqual({ kind: 'blank' });
    expect(asName(' \t ', 120)).toEqual({ kind: 'blank' });
  });

  it('refuses a name of letters a reader cannot see, alone or with space, as blank, given and written', () => {
    // Each is a letter, so the name has something in it besides space, and a
    // list would show it as nothing at all.
    for (const name of [
      HANGUL_FILLER,
      ` ${CHOSEONG_FILLER}  `,
      `${CHOSEONG_FILLER} ${HANGUL_FILLER}`,
    ]) {
      expect(asName(name, 120), JSON.stringify(name)).toEqual({ kind: 'blank' });
      expect(asWrittenName(name, 120), JSON.stringify(name)).toEqual({ kind: 'blank' });
    }
    expect(asName(`${HANGUL_FILLER}Mixing`, 120)).toBe(`${HANGUL_FILLER}Mixing`);
  });

  it('refuses a value that is not text as blank, so a reader of it words that refusal once', () => {
    for (const value of [undefined, null, 42, {}, ['Mixing']]) {
      expect(asName(value, 120), JSON.stringify(value)).toEqual({ kind: 'blank' });
    }
  });

  it('refuses a name past its bound in the characters a reader sees', () => {
    expect(asName('😀'.repeat(121), 120)).toEqual({ kind: 'too-long' });
    expect(asName('w'.repeat(121), 120)).toEqual({ kind: 'too-long' });
  });

  it('is given without the space around it, which the bound does not count', () => {
    expect(asName('  Mixing \t', 120)).toBe('Mixing');
    expect(asName(' Mixing  desk ', 120)).toBe('Mixing  desk');
    expect(asName(` ${'w'.repeat(120)} `, 120)).toBe('w'.repeat(120));
  });

  it('is read from stored text as it is written, held to the same rule', () => {
    expect(asWrittenName(' Mixing ', 120)).toBe(' Mixing ');
    expect(asWrittenName(` ${'w'.repeat(120)} `, 120)).toBe(` ${'w'.repeat(120)} `);
    expect(asWrittenName(' \t ', 120)).toEqual({ kind: 'blank' });
    expect(asWrittenName(42, 120)).toEqual({ kind: 'blank' });
    expect(asWrittenName('w'.repeat(121), 120)).toEqual({ kind: 'too-long' });
  });
});

describe('two names compared as a reader hears them', () => {
  it('are one where they differ only in case', () => {
    expect(sameName('Mixing', 'mixing')).toBe(true);
    expect(sameName('MIXING DESK', 'Mixing desk')).toBe(true);
  });

  it('are one where they differ only in the space around or inside them', () => {
    expect(sameName('  Mixing ', 'Mixing')).toBe(true);
    expect(sameName('Mixing  desk', 'Mixing desk')).toBe(true);
  });

  it('are one where a letter is written as one code point or as a letter and its mark', () => {
    expect(sameName('Mötley', `Mo${DIAERESIS}tley`)).toBe(true);
  });

  it('are two where a letter differs, or carries an accent in one alone', () => {
    expect(sameName('Mixing', 'Mastering')).toBe(false);
    expect(sameName('Mötley', 'Motley')).toBe(false);
    expect(sameName('Mixing desk', 'Mixingdesk')).toBe(false);
  });
});

describe('two names compared on any machine', () => {
  const RealCollator = Intl.Collator;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /**
   * The runtime's collator, built for `locale` wherever a caller names no
   * language, or for `locale` whatever the caller names where `always` holds.
   */
  function collatorOf(locale: string, always = false): void {
    vi.spyOn(Intl, 'Collator').mockImplementation(
      class extends RealCollator {
        constructor(locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
          super(always ? locale : (locales ?? locale), options);
        }
      },
    );
  }

  /** `sameName` as it loads on a machine whose language is `locale`. */
  async function sameNameWhereTheLanguageIs(locale: string): Promise<typeof sameName> {
    collatorOf(locale);
    // The machine speaks `locale`: a collator given no language takes it.
    expect(new Intl.Collator().resolvedOptions().locale).toBe(locale);
    vi.resetModules();
    return (await import('./names.js')).sameName;
  }

  it.each(['tr', 'th', 'da'])(
    'are one or two alike where the machine speaks %s',
    async (locale) => {
      // Left to the machine's language, Turkish would hold "MIXING" and
      // "mixing" to be two names, Thai "Mixing desk" and "Mixing-desk" to be
      // one, and Danish "Gaard" and "Gård".
      const same = await sameNameWhereTheLanguageIs(locale);

      expect(same('MIXING DESK', 'Mixing desk')).toBe(true);
      expect(same('Mixing', 'mixing')).toBe(true);
      expect(same('Mötley', `Mo${DIAERESIS}tley`)).toBe(true);
      expect(same('Mixing desk', 'Mixingdesk')).toBe(false);
      expect(same('Mixing desk', 'Mixing-desk')).toBe(false);
      expect(same('Mix 01', 'Mix 1')).toBe(false);
      expect(same('Mötley', 'Motley')).toBe(false);
      expect(same('ı', 'I')).toBe(false);
      expect(same('Gaard', 'Gård')).toBe(false);
    },
  );

  it('are refused, and the rest of the package kept, where the runtime cannot compare them by English collation', async () => {
    // A check made where the package loads stops every package that reads it,
    // the logger and the keyboard among them, before a word can be shown.
    collatorOf('tr', true);
    vi.resetModules();

    const text = await import('./index.js');
    expect(text.wholeCharactersWithin('Mixing desk', 6)).toBe('Mixing');
    expect(text.oneCharacter('é')).toBe(true);
    expect(text.namesCanBeCompared()).toBe(false);

    const held = [{ id: 'mixing', displayName: 'Mixing' }];
    const refusal =
      'Names are compared by English collation, punctuation and digits as they are written, and this runtime resolved "tr".';
    expect(() => text.holderOf(held, 'mixing')).toThrow(refusal);
    expect(() => text.namesHeldBy(held)).toThrow(refusal);
    expect(() => text.firstFreeCopyName('Mixing copy', 'copy', 120, () => false)).toThrow(refusal);
  });

  it('are refused where the runtime reads digits in a name as numbers', async () => {
    vi.spyOn(Intl, 'Collator').mockImplementation(
      class extends RealCollator {
        constructor(locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
          super(locales, { ...options, numeric: true });
        }
      },
    );
    vi.resetModules();

    const names = await import('./names.js');
    expect(names.namesCanBeCompared()).toBe(false);
    expect(() => names.sameName('Mix 01', 'Mix 1')).toThrow(
      'Names are compared by English collation, punctuation and digits as they are written, and this runtime resolved "en", reading digits as numbers.',
    );
  });

  it('refuses naming, and answers the probe and every caller alike, where the runtime cannot make its collator', async () => {
    // The probe at start and each caller after it read one answer: the
    // constructor is asked once, and a caller is told why naming is refused
    // rather than handed the constructor's own error.
    const made = vi.spyOn(Intl, 'Collator').mockImplementation(function () {
      throw new RangeError('Incorrect locale information provided');
    });
    vi.resetModules();
    const names = await import('./names.js');

    expect(names.namesCanBeCompared()).toBe(false);
    expect(names.namesCanBeCompared()).toBe(false);
    expect(made).toHaveBeenCalledTimes(1);
    expect(() => names.sameName('Mixing', 'mixing')).toThrow(
      'Names are compared by English collation, and this runtime cannot make a collator for it.',
    );
    expect(made).toHaveBeenCalledTimes(1);
  });

  it('are compared where the runtime gives English collation, and the check is not asked again', async () => {
    vi.resetModules();
    const names = await import('./names.js');
    const made = vi.spyOn(Intl, 'Collator');

    expect(names.namesCanBeCompared()).toBe(true);
    expect(names.sameName('Mixing', 'MIXING')).toBe(true);
    expect(names.sameName('Mixing', 'Mastering')).toBe(false);
    expect(made).toHaveBeenCalledTimes(1);
  });
});

describe('the first name free of those in use', () => {
  const none = (): boolean => false;

  it('is the name, or what a copy adds to it, and no number, where nothing has it', () => {
    expect(firstFreeCopyName('Editing', 'copy', 120, none)).toBe('Editing copy');
    expect(firstFreeName('My shortcuts', 120, none)).toBe('My shortcuts');
  });

  it('takes the first free number from two, asked of the whole name', () => {
    const taken = new Set(['My shortcuts', 'My shortcuts 2']);
    expect(firstFreeName('My shortcuts', 120, (name) => taken.has(name))).toBe('My shortcuts 3');

    const copies = new Set(['Mine copy']);
    expect(firstFreeCopyName('Mine', 'copy', 120, (name) => copies.has(name))).toBe('Mine copy 2');
  });

  it('numbers the name without the space around it', () => {
    const taken = new Set(['Mine']);
    expect(firstFreeName('Mine ', 120, (name) => taken.has(name))).toBe('Mine 2');
    expect(firstFreeName(' mine', 120, none)).toBe('mine');
    expect(firstFreeCopyName(' Mine ', 'copy', 120, none)).toBe('Mine copy');
  });

  it('numbers a copy of a copy in the series of the name it is a copy of', () => {
    // A copy of "Editing copy" was "Editing copy copy", a name that grew with
    // each copy of a copy.
    const held = new Set(['Editing', 'Editing copy']);
    const taken = (name: string): boolean => held.has(name);
    expect(firstFreeCopyName('Editing copy', 'copy', 120, taken)).toBe('Editing copy 2');

    held.add('Editing copy 2');
    expect(firstFreeCopyName('Editing copy', 'copy', 120, taken)).toBe('Editing copy 3');
    expect(firstFreeCopyName('Editing copy 2', 'copy', 120, taken)).toBe('Editing copy 3');
    expect(firstFreeCopyName(' Editing copy 2 ', 'copy', 120, taken)).toBe('Editing copy 3');

    // The series starts at its own name where that is free again.
    held.delete('Editing copy');
    expect(firstFreeCopyName('Editing copy 2', 'copy', 120, taken)).toBe('Editing copy');
  });

  it("copies a name that only ends in a word like a copy's as a name of its own", () => {
    expect(firstFreeCopyName('My shortcuts 2', 'copy', 120, none)).toBe('My shortcuts 2 copy');
    expect(firstFreeCopyName('Photocopy', 'copy', 120, none)).toBe('Photocopy copy');
    expect(firstFreeCopyName('copy', 'copy', 120, none)).toBe('copy copy');
    expect(firstFreeCopyName('Editing copy two', 'copy', 120, none)).toBe('Editing copy two copy');
  });

  it("reads a copy's name as names are compared, so a name heard as a copy's is in its series", () => {
    // Read by its letters, "Editing Copy" would be copied as "Editing Copy
    // copy", which a reader hears as the "Editing copy copy" the series is
    // there to keep from growing.
    const namesHeld =
      (...held: string[]) =>
      (name: string) =>
        held.some((one) => sameName(one, name));

    expect(
      firstFreeCopyName('Editing Copy', 'copy', 120, namesHeld('Editing', 'Editing Copy')),
    ).toBe('Editing copy 2');
    expect(
      firstFreeCopyName('Editing  copy', 'copy', 120, namesHeld('Editing', 'Editing  copy')),
    ).toBe('Editing copy 2');
    expect(firstFreeCopyName('Editing COPY  3', 'copy', 120, none)).toBe('Editing copy');
  });

  it('adds the word the caller gives, and reads a series by that word alone', () => {
    expect(firstFreeCopyName('Editing', 'kopia', 120, none)).toBe('Editing kopia');
    const held = new Set(['Editing kopia', 'Mix copie de']);
    const taken = (name: string): boolean => held.has(name);
    expect(firstFreeCopyName('Editing kopia', 'kopia', 120, taken)).toBe('Editing kopia 2');
    expect(firstFreeCopyName('Mix copie de', 'copie de', 120, taken)).toBe('Mix copie de 2');
    expect(firstFreeCopyName('Editing copy', 'kopia', 120, none)).toBe('Editing copy kopia');
  });

  it('counts the word a copy adds in characters, however many code units they are', () => {
    // Counted in code units, a word of one character and two code units
    // would take a character more of the name than the bound needs.
    expect(firstFreeCopyName('w'.repeat(120), '📋', 120, none)).toBe(`${'w'.repeat(117)}… 📋`);
  });

  it('cuts the name at a word, in characters, to leave room for what follows it', () => {
    // Twenty-three words and a spare end are 118 characters; what a copy adds
    // is five, which leaves the name 115, in which the twenty-three words fit
    // whole.
    const long = `${'word '.repeat(23)}end`;
    expect(firstFreeCopyName(long, 'copy', 120, none)).toBe(`${'word '.repeat(22)}word… copy`);

    // Each of these is two code units: cut in code units, half would be kept.
    expect(firstFreeCopyName('😀'.repeat(120), 'copy', 120, none)).toBe(
      `${'😀'.repeat(114)}… copy`,
    );
  });

  it('keeps room for the number too, so the whole name is within the bound', () => {
    // The number takes two characters more, so the cut falls inside the
    // twenty-third word and the name ends at the word before it.
    const long = `${'word '.repeat(23)}end`;
    const taken = new Set([`${'word '.repeat(22)}word… copy`]);
    const numbered = firstFreeCopyName(long, 'copy', 120, (name) => taken.has(name));

    expect(numbered).toBe(`${'word '.repeat(21)}word… copy 2`);
    expect(numbered.length).toBeLessThanOrEqual(120);
  });
});
