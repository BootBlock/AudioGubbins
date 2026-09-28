import { describe, expect, it } from 'vitest';

import { identifierRule } from './holders.js';
import { identifierOf, isIdentifier, numberedIdentifier, utf8Bytes } from './identifiers.js';

/** A combining dot above, which a reader sees as part of the letter before it. */
const DOT_ABOVE = String.fromCodePoint(0x307);

/** A right-to-left override, which turns the text after it around. */
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);

/** A combining acute accent, which a reader sees as part of the letter before it. */
const ACUTE = String.fromCodePoint(0x301);

/** The Hangul filler, a letter a reader sees as a blank gap. */
const HANGUL_FILLER = String.fromCodePoint(0x3164);

/** The Hangul jungseong filler, the letter the filler's compatibility form is. */
const JUNGSEONG_FILLER = String.fromCodePoint(0x1160);

/** The Hangul choseong filler, the other filler a name keeps in that form. */
const CHOSEONG_FILLER = String.fromCodePoint(0x115f);

/** The half-width Hangul filler, whose compatibility form is the jungseong one. */
const HALF_WIDTH_FILLER = String.fromCodePoint(0xffa0);

/** The sixteenth variation selector, which asks for the letter before it drawn as an emoji. */
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);

/** The first ideographic variation selector, outside the basic plane. */
const IDEOGRAPHIC_VARIATION_SELECTOR = String.fromCodePoint(0xe0100);

/** A zero-width joiner, which asks for the characters either side of it joined. */
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);

/** A soft hyphen, which shows only where a line breaks at it. */
const SOFT_HYPHEN = String.fromCodePoint(0xad);

/** A zero-width space, which marks where a line may break and shows nothing. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/** A code point a runtime shows as nothing where it does not otherwise support it. */
const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;

/** A letter, in any script. */
const LETTER = /^\p{L}$/u;

/** How many bytes `text` takes in UTF-8, counted by the platform's encoder. */
const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

/** A bound a caller gives an identifier, in UTF-8 bytes, and a short one. */
const LONGEST = 227;
const SHORT = 16;

/** A name of 120 letters in Cyrillic, each two bytes in UTF-8. */
const CYRILLIC = 'Ж'.repeat(120);

describe('the identifier derived from a name', () => {
  it('is the name in lower case, each run of anything but a letter, a mark or a digit one hyphen', () => {
    expect(identifierOf("Jane's  Mix!", 'workspace', LONGEST)).toBe('jane-s-mix');
    expect(identifierOf("Jane's  Keys!", 'profile', LONGEST)).toBe('jane-s-keys');
    expect(identifierOf('Editing, mine', 'workspace', LONGEST)).toBe('editing-mine');
  });

  it('keeps the letters of a name in any script, and the marks a reader sees on them', () => {
    // Kept to the letters a to z, "Écoute" would be `coute`, and a name in
    // Cyrillic or Japanese would leave nothing and take the caller's word.
    expect(identifierOf('Écoute', 'profile', LONGEST)).toBe('écoute');
    expect(identifierOf('Café Mix', 'workspace', LONGEST)).toBe('café-mix');
    expect(identifierOf('Мои клавиши', 'profile', LONGEST)).toBe('мои-клавиши');
    expect(identifierOf('日本', 'workspace', LONGEST)).toBe('日本');
    expect(identifierOf('Straße', 'profile', LONGEST)).toBe('straße');
    expect(identifierOf('İstanbul', 'workspace', LONGEST)).toBe(`i${DOT_ABOVE}stanbul`);
  });

  it('reads a ligature, a letter in full width or a Roman numeral as the letters it is read as', () => {
    expect(identifierOf('ﬁle Ⅸ', 'workspace', LONGEST)).toBe('file-ix');
    expect(identifierOf('Ｍｉｘ', 'workspace', LONGEST)).toBe('mix');
  });

  it('starts and ends with a letter or a digit, whatever the name starts and ends with', () => {
    expect(identifierOf('  Mixing! ', 'workspace', LONGEST)).toBe('mixing');
    expect(identifierOf('(Recording) 2', 'workspace', LONGEST)).toBe('recording-2');
  });

  it('is the one a caller gives where the name leaves nothing an identifier keeps', () => {
    expect(identifierOf('***', 'workspace', LONGEST)).toBe('workspace');
    expect(identifierOf('***', 'profile', LONGEST)).toBe('profile');
    expect(identifierOf('', 'profile', LONGEST)).toBe('profile');
    expect(identifierOf('— ? —', 'profile', LONGEST)).toBe('profile');
  });

  it('keeps no letter a reader cannot see', () => {
    // Kept, a name of a filler alone would be held under an identifier that
    // reads as nothing, and one with a filler inside it as another name.
    expect(identifierOf(`a${HANGUL_FILLER}b`, 'profile', LONGEST)).toBe('a-b');
    expect(identifierOf(HANGUL_FILLER, 'profile', LONGEST)).toBe('profile');
    for (const filler of [CHOSEONG_FILLER, JUNGSEONG_FILLER, HALF_WIDTH_FILLER]) {
      expect(identifierOf(`a${filler}b`, 'profile', LONGEST)).toBe('a-b');
    }
  });

  it('leaves out a variation selector between two letters, and adds no hyphen where it sits', () => {
    // A variation selector chooses how the character before it is drawn, and
    // a reader sees no gap where it sits.
    expect(identifierOf(`a${VARIATION_SELECTOR}b`, 'profile', LONGEST)).toBe('ab');
    expect(identifierOf(`葛${IDEOGRAPHIC_VARIATION_SELECTOR}飾`, 'workspace', LONGEST)).toBe(
      '葛飾',
    );
  });

  it('leaves out a joiner or a soft hyphen inside a word, and keeps the word whole', () => {
    expect(identifierOf(`Mix${ZERO_WIDTH_JOINER}ing`, 'workspace', LONGEST)).toBe('mixing');
    expect(identifierOf(`Mix${SOFT_HYPHEN}ing`, 'workspace', LONGEST)).toBe('mixing');
  });

  it('leaves out zero-width spaces around and between letters', () => {
    const around = `${ZERO_WIDTH_SPACE}a${ZERO_WIDTH_SPACE}`;
    expect(identifierOf(around, 'profile', LONGEST)).toBe('a');
    expect(identifierOf(`${around}b${ZERO_WIDTH_SPACE}`, 'profile', LONGEST)).toBe('ab');
    expect(identifierOf(ZERO_WIDTH_SPACE, 'profile', LONGEST)).toBe('profile');
  });

  it('keeps a mark on its letter where a zero-width character sits between them, in the form a name derives', () => {
    // Left out after the compatibility form, the joiner would leave the accent
    // apart from its letter, an identifier that is not its own.
    const derived = identifierOf(`e${ZERO_WIDTH_JOINER}${ACUTE}`, 'profile', LONGEST);
    expect(derived).toBe('é');
    expect(isIdentifier(derived, LONGEST)).toBe(true);
  });

  it('derives nothing from each code point a reader sees nothing of, and a gap from each filler, in every plane', () => {
    // Every default-ignorable code point, assigned or not, between two letters:
    // each but a letter leaves the two joined, and the letters among them, the
    // Hangul fillers alone, which a reader sees as a blank gap, separate them.
    const wrong: string[] = [];
    const letters: number[] = [];
    for (let point = 0; point <= 0x10ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      const character = String.fromCodePoint(point);
      if (!DEFAULT_IGNORABLE.test(character)) continue;
      const letter = LETTER.test(character);
      if (letter) letters.push(point);
      const derived = identifierOf(`a${character}b`, 'profile', LONGEST);
      if (derived !== (letter ? 'a-b' : 'ab')) wrong.push(point.toString(16));
    }
    expect(wrong).toEqual([]);
    expect(letters).toEqual([0x115f, 0x1160, 0x3164, 0xffa0]);
  });

  it('numbers a name whose identifier Windows reserves for a device', () => {
    // Windows reserves the name before the first dot whatever follows it, so
    // a file named after one is saved under another name.
    const identifiers = identifierRule(LONGEST).identifiersHeldBy([], 'profile');

    expect(['Con', 'NUL', 'com1', 'LPT9'].map((name) => identifiers.forName(name))).toEqual([
      'con-2',
      'nul-2',
      'com1-2',
      'lpt9-2',
    ]);
    expect(identifiers.forName('CON')).toBe('con-3');
    expect(identifiers.forName('Console')).toBe('console');
  });

  it('is an identifier itself where derived from one, so a stored one keeps its place', () => {
    expect(identifierOf('mine', 'profile', LONGEST)).toBe('mine');
    expect(identifierOf('mastering-2', 'profile', LONGEST)).toBe('mastering-2');
  });

  it.each([SHORT, LONGEST])(
    'is cut at a whole character to a bound of %i bytes the caller gives, numbered or not',
    (bound) => {
      // Derived whole, 120 letters in Cyrillic are 240 bytes, past either bound.
      const derived = identifierOf(CYRILLIC, 'profile', bound);
      expect(derived).toBe('ж'.repeat(Math.floor(bound / 2)));
      expect(isIdentifier(derived, bound)).toBe(true);

      for (const number of [2, 10, 1000]) {
        const numbered = numberedIdentifier(derived, number, 'profile', bound);
        expect(numbered.endsWith(`-${String(number)}`)).toBe(true);
        expect(bytesOf(numbered)).toBeLessThanOrEqual(bound);
        expect(isIdentifier(numbered, bound)).toBe(true);
      }
    },
  );

  it('keeps a letter with the marks on it where it is cut, and ends with no hyphen', () => {
    const marked = identifierOf(`${'a'.repeat(LONGEST - 2)}e${ACUTE}${ACUTE}`, 'x', LONGEST);
    expect(marked).toBe('a'.repeat(LONGEST - 2));

    const hyphenated = identifierOf(`${'a'.repeat(LONGEST - 1)} b`, 'x', LONGEST);
    expect(hyphenated).toBe('a'.repeat(LONGEST - 1));
    expect(isIdentifier(hyphenated, LONGEST)).toBe(true);
  });
});

describe('an identifier read from storage', () => {
  it('is one where it is in the shape an identifier is derived in', () => {
    for (const id of ['default', 'editing', 'mine-2', 'écoute', 'мои-клавиши', '日本']) {
      expect(isIdentifier(id, LONGEST)).toBe(true);
    }
  });

  it.each([SHORT, LONGEST])(
    'is one within a bound of %i bytes the caller gives, and not a byte past it',
    (bound) => {
      expect(isIdentifier('x'.repeat(bound), bound)).toBe(true);
      expect(isIdentifier('x'.repeat(bound + 1), bound)).toBe(false);
      expect(isIdentifier('ж'.repeat(Math.floor(bound / 2)), bound)).toBe(true);
      expect(isIdentifier('ж'.repeat(Math.floor(bound / 2) + 1), bound)).toBe(false);
      expect(identifierRule(bound).isIdentifier('x'.repeat(bound))).toBe(true);
      expect(identifierRule(bound).isIdentifier('x'.repeat(bound + 1))).toBe(false);
    },
  );

  it('is refused in a case or a form no name derives, which would sit beside the one derived', () => {
    // Kept, a stored "Mine" would sit beside the "mine" its name derives, as
    // two entries a reader cannot tell apart.
    for (const id of ['Mine', 'Écoute', 'e\u0301coute', 'ﬁle', 'Ｍｉｘ', 'MINE-2']) {
      expect(isIdentifier(id, LONGEST), id).toBe(false);
    }
  });

  it.each([SHORT, LONGEST])(
    'is every identifier a rule of %i bytes gives, derived from any character, cut or numbered',
    (bound) => {
      // Each character of the basic plane alone and after a letter, so every
      // script, mark, ligature and case the derivation reads is read once, and
      // given beside those given before it, so a clash is numbered; then each
      // code point of the other planes a reader sees nothing of, the
      // ideographic variation selectors among them, alone, after a letter and
      // between two; then each name Windows reserves for a device.
      const rule = identifierRule(bound);
      const identifiers = rule.identifiersHeldBy([], 'profile');
      const refused: string[] = [];
      const give = (name: string): void => {
        const given = identifiers.forName(name);
        if (!rule.isIdentifier(given) || utf8Bytes(given) > bound) refused.push(given);
      };
      for (let point = 0; point <= 0xffff; point += 1) {
        if (point >= 0xd800 && point <= 0xdfff) continue;
        const character = String.fromCodePoint(point);
        give(character);
        give(`a${character}`);
      }
      for (let point = 0x10000; point <= 0x10ffff; point += 1) {
        const character = String.fromCodePoint(point);
        if (!DEFAULT_IGNORABLE.test(character)) continue;
        give(character);
        give(`a${character}`);
        give(`a${character}b`);
      }
      for (const stem of ['CON', 'Prn', 'aux', 'NUL', 'COM', 'lpt']) {
        give(stem);
        for (let digit = 0; digit <= 9; digit += 1) give(`${stem}${String(digit)}`);
      }
      give(`${'é'.repeat(200)} Mix`);
      give(`${'é'.repeat(200)} Mix`);
      expect(refused).toEqual([]);

      const cut = identifierOf(`${'é'.repeat(200)} Mix`, 'profile', bound);
      expect(isIdentifier(numberedIdentifier(cut, 1000, 'profile', bound), bound)).toBe(true);
    },
  );

  it('is refused empty, too long, or with anything but letters, marks, digits and single hyphens', () => {
    // Kept, each would be where storage keeps an entry and the words of a
    // message: a hidden file, a name cut short, an extension turned around, a
    // separator or a second line, where a file is named after it.
    for (const id of [
      '',
      `a${RIGHT_TO_LEFT_OVERRIDE}gnp.exe`,
      'x'.repeat(1_000_000),
      'a/b',
      'a\\b',
      'a\nb',
      'a b',
      'a.b',
      '-a',
      'a-',
      'a--b',
    ]) {
      expect(isIdentifier(id, LONGEST), JSON.stringify(id.slice(0, 20))).toBe(false);
    }
  });

  it('is refused where Windows reserves it for a device, or where it holds a letter a reader cannot see', () => {
    // Kept, the first would name a file Windows keeps for a device, and the
    // second a file whose name reads as nothing.
    for (const id of ['con', 'com1', 'lpt0', JUNGSEONG_FILLER, `a${JUNGSEONG_FILLER}b`]) {
      expect(isIdentifier(id, LONGEST), JSON.stringify(id)).toBe(false);
    }
    expect(isIdentifier('con-2', LONGEST)).toBe(true);
    expect(isIdentifier('console', LONGEST)).toBe(true);
  });
});

describe('the bound an identifier rule is given', () => {
  it('is refused where it is not a whole number of bytes, at least one', () => {
    // Taken, such a bound would refuse every identifier read from storage.
    for (const bound of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => identifierRule(bound), String(bound)).toThrow(RangeError);
    }
    expect(identifierRule(1).isIdentifier('a')).toBe(true);
  });
});

describe('the bytes a text takes in UTF-8', () => {
  it('are those the platform encodes it in, in every plane', () => {
    for (const text of ['', 'mix', 'é', 'ж', '日本', '😀', `a${HANGUL_FILLER}`]) {
      expect(utf8Bytes(text), text).toBe(bytesOf(text));
    }
    // Half a surrogate pair is written as the replacement character.
    expect(utf8Bytes('\ud800')).toBe(3);
  });
});
