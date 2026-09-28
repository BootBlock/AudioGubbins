import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Characters from './graphemes.js';
import { graphemes, longerThan, oneCharacter } from './graphemes.js';

/**
 * The characters a reader sees. A browser inside this build's floor may have no
 * segmenter, and reading one at module scope would stop the shell starting at
 * all.
 */

/** A combining acute accent, which a reader sees as part of the letter before it. */
const ACUTE = String.fromCodePoint(0x301);

describe('the characters a reader sees', () => {
  it('reads a letter with a combining mark as one', () => {
    expect([...graphemes(`e${ACUTE}`)]).toEqual([`e${ACUTE}`]);
    expect(oneCharacter(`e${ACUTE}`)).toBe(true);
  });

  it('reads a character outside the basic plane as one', () => {
    expect(oneCharacter('😀')).toBe(true);
  });

  it('reads two letters as two', () => {
    expect([...graphemes('ab')]).toEqual(['a', 'b']);
    expect(oneCharacter('ab')).toBe(false);
  });

  it('reads a capital that is two letters as two', () => {
    // The German sharp s is SS in capitals, and no keycap shows two letters.
    expect(oneCharacter('ß'.toUpperCase())).toBe(false);
  });
});

describe('a count of the characters a reader sees', () => {
  it('counts what a reader sees rather than the code units', () => {
    // A hundred and twenty of them, each two code units long.
    expect(longerThan('😀'.repeat(120), 120)).toBe(false);
    expect(longerThan('😀'.repeat(121), 120)).toBe(true);
    expect(longerThan(`e${ACUTE}`.repeat(3), 3)).toBe(false);
  });

  it('counts a character that runs across the end of what is read at a time as one', () => {
    // The text is read a thousand and twenty-four code units at a time, and
    // this letter's mark is the first unit past the first of them.
    const straddling = `${'a'.repeat(1023)}e${ACUTE}b`;

    expect(longerThan(straddling, 1025)).toBe(false);
    expect(longerThan(straddling, 1024)).toBe(true);
  });

  it('counts a character longer than what is read at a time once for each allowance it fills', () => {
    // 3001 code units, longer than one part: read whole, not in pieces, and
    // counted as the 94 allowances of 32 it fills, with the letter after it.
    expect(longerThan(`e${ACUTE.repeat(3000)}b`, 95)).toBe(false);
    expect(longerThan(`e${ACUTE.repeat(3000)}b`, 94)).toBe(true);
  });

  it('reads a character longer than the allowance as more than one, as every count does', () => {
    // A letter with its accent is one character; the same letter under forty
    // marks is one to a reader, and several to every count in the package,
    // which is how a bound in characters holds the size. No key types one.
    expect(oneCharacter(`e${ACUTE}`)).toBe(true);
    expect(oneCharacter(`e${ACUTE.repeat(40)}`)).toBe(false);
  });

  it('holds the size of a text within the bound, however its characters are built', () => {
    // One letter under a hundred thousand marks, and a hundred letters under
    // forty marks each: a reader sees one character and a hundred, and a live
    // region would read a hundred thousand code units and four thousand.
    expect(longerThan(`e${ACUTE.repeat(100_000)}`, 120)).toBe(true);
    expect(longerThan(`e${ACUTE.repeat(40)}`.repeat(100), 120)).toBe(true);
    expect(longerThan(`e${ACUTE.repeat(20)}`.repeat(100), 120)).toBe(false);
  });

  it('reads no further than the character past the bound, however long the text', () => {
    // A name from a shared profile may be megabytes long. Read to its end,
    // twice the text was twice the work; read to the bound, the same. Held as
    // how much text the segmenter is handed rather than as a time, which a
    // machine fast enough to finish under the timer's floor would let through.
    const handed = (text: string): number => {
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
      try {
        expect(longerThan(text, 120)).toBe(true);
        return segment.mock.calls.reduce((sum, [part]) => sum + part.length, 0);
      } finally {
        segment.mockRestore();
      }
    };

    const once = handed('n'.repeat(1_000_000));
    expect(handed('n'.repeat(2_000_000))).toBe(once);
    expect(once).toBeLessThan(4 * 1_024);
    // And at least the characters counted: a count that segments some other way
    // would hand this nothing, and would pass the bound above whatever it read.
    expect(once, 'the count saw none of the segmenting').toBeGreaterThanOrEqual(121);

    // One character a megabyte long, read in ever wider parts, is read no
    // further than the allowances the rest of the count needs.
    expect(handed(`e${ACUTE.repeat(2_000_000)}`)).toBeLessThan(8 * 1_024);
  });
});

describe('a browser with no segmenter', () => {
  const real = Intl.Segmenter;

  afterEach(() => {
    Object.defineProperty(Intl, 'Segmenter', { value: real, configurable: true, writable: true });
    vi.resetModules();
  });

  /**
   * The module as such a browser loads it: afresh, with the constructor gone.
   *
   * Loaded once for the whole file, it would already have been read while the
   * segmenter was present, and a segmenter a test above had built would stand
   * in for the missing one, so neither a constructor called at load nor a guard
   * taken away could fail here.
   */
  async function loadedWithoutASegmenter(): Promise<typeof Characters> {
    Object.defineProperty(Intl, 'Segmenter', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    return await import('./graphemes.js');
  }

  it('reads code points instead, rather than failing to load at all', async () => {
    // Read at module scope, building one threw while the module loaded and the
    // shell never started. A code point is one character a reader sees for
    // every character a keyboard types.
    const fresh = await loadedWithoutASegmenter();

    expect([...fresh.graphemes('ab')]).toEqual(['a', 'b']);
    expect(fresh.oneCharacter('😀')).toBe(true);
  });

  it('keeps a letter with the combining mark a reader sees on it', async () => {
    // Read as bare code points, a cut there left the letter and moved its
    // accent onto whatever came after the cut.
    const fresh = await loadedWithoutASegmenter();

    expect([...fresh.graphemes(`ae${ACUTE}${ACUTE}b`)]).toEqual(['a', `e${ACUTE}${ACUTE}`, 'b']);
    expect(fresh.oneCharacter(`e${ACUTE}`)).toBe(true);
  });

  it('keeps a flag, a skin tone, a joined emoji and a line ending whole', async () => {
    // Each was read as its parts, so a cut or a count fell inside it on the
    // floor's own Firefox, which has no segmenter.
    const fresh = await loadedWithoutASegmenter();
    const flag = String.fromCodePoint(0x1f1ec, 0x1f1e7);
    const wave = String.fromCodePoint(0x1f44b, 0x1f3fd);
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

    expect([...fresh.graphemes(`a${flag}${wave}${family}\r\nb`)]).toEqual([
      'a',
      flag,
      wave,
      family,
      '\r\n',
      'b',
    ]);
  });
});
