import { describe, expect, it } from 'vitest';

import { asQuoted, quoted } from './quoting.js';

/**
 * Quoting a value a refusal was given. The value came from storage or from a
 * file a reader was sent, so its length and its shape are nobody's to promise.
 */

/** A combining acute accent, which a reader sees as part of the letter before it. */
const ACUTE = String.fromCodePoint(0x301);

describe('a name as a sentence quotes it', () => {
  it('is the name whole between typographic quotation marks', () => {
    expect(quoted('Take 2')).toBe('“Take 2”');
  });

  it('keeps a quotation mark the name holds, so the name is not changed', () => {
    expect(quoted('The "B" side')).toBe('“The "B" side”');
  });
});

describe('a value as a refusal quotes it', () => {
  it('is the value itself while it is short enough to read', () => {
    expect(asQuoted('Editing')).toBe('Editing');
    expect(asQuoted(3)).toBe('3');
  });

  it('is one line, however the value was written', () => {
    // A stored layout carries newlines and runs of spaces, and a sentence is
    // read out as well as shown.
    expect(asQuoted(' Editing\n\tthe  take ')).toBe('Editing the take');
  });

  it('names the kind of a value that is not text, rather than printing it', () => {
    expect(asQuoted({ layout: 'x' })).toBe('a value of another kind');
    expect(asQuoted([1, 2])).toBe('a value of another kind');
  });

  it('is cut to the same length whatever it was given', () => {
    // Four megabytes of a stored layout went into a status bar, a log, a
    // bundle and an assertive live region; a quarter of a megabyte of an
    // imported profile's version field went the same way.
    const quoted = asQuoted('v'.repeat(250_000));

    expect(quoted).toBe(`${'v'.repeat(39)}…`);
  });

  it('never leaves half of a character that is written as two code units', () => {
    // The bound is code units, and a character outside the basic plane is two
    // of them: cut between the halves, a reader would be shown a replacement
    // character and a screen reader would read nothing at all.
    const cutMidPair = `${'a'.repeat(38)}😀${'b'.repeat(40)}`;

    const quoted = asQuoted(cutMidPair);
    expect(quoted).toBe(`${'a'.repeat(38)}…`);

    // And the character itself is kept where the whole of it fits.
    expect(asQuoted(`${'a'.repeat(37)}😀${'b'.repeat(40)}`)).toBe(`${'a'.repeat(37)}😀…`);
  });

  it('never leaves a letter without the mark a reader sees on it', () => {
    // The other half of the same rule, and the one a bound counted in code
    // units could not keep: the bound falls between a letter and the accent
    // that belongs to it, and cut there, the accent would land on the ellipsis.
    const cutMidLetter = `${'a'.repeat(38)}e${ACUTE}${'b'.repeat(40)}`;

    expect(asQuoted(cutMidLetter)).toBe(`${'a'.repeat(38)}…`);

    // And the letter with its mark is kept where the whole of it fits.
    expect(asQuoted(`${'a'.repeat(37)}e${ACUTE}${'b'.repeat(40)}`)).toBe(
      `${'a'.repeat(37)}e${ACUTE}…`,
    );
  });
});
