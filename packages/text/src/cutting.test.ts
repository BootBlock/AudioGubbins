import { describe, expect, it, vi } from 'vitest';

import {
  cutAtAWord,
  cutAtAWordToCharacters,
  cutToBound,
  sentencesWithin,
  wholeCharactersWithin,
} from './cutting.js';
import { LONGEST_CHARACTER, longerThan } from './graphemes.js';

/**
 * Where text a reader is shown, or read, is cut. The rules are kept in one
 * package, so that the guard against cutting a character in half is not left to
 * one of them alone.
 */

/** A combining acute accent, which a reader sees as part of the letter before it. */
const ACUTE = String.fromCodePoint(0x301);

describe('a text cut to a bound', () => {
  it('is the whole of a text already inside the bound', () => {
    expect(cutToBound('Editing', 40)).toBe('Editing');
  });

  it('cuts at the bound where every character is one code unit, the ellipsis inside it', () => {
    expect(cutToBound('a'.repeat(50), 40)).toBe(`${'a'.repeat(39)}…`);
  });

  it('leaves out a character the bound falls inside', () => {
    // Half a pair is shown as a replacement character and read as nothing; a
    // letter without its mark puts the mark on whatever follows the cut.
    expect(cutToBound(`${'a'.repeat(38)}😀b`, 40)).toBe(`${'a'.repeat(38)}…`);
    expect(cutToBound(`${'a'.repeat(38)}e${ACUTE}b`, 40)).toBe(`${'a'.repeat(38)}…`);
  });

  it('keeps a character the bound falls exactly at the end of', () => {
    expect(cutToBound(`${'a'.repeat(37)}😀bc`, 40)).toBe(`${'a'.repeat(37)}😀…`);
  });

  it('leaves out a character longer than the allowance read past the bound', () => {
    // A letter with forty marks on it is one character and forty-one code
    // units, and the segmenter is handed thirty-two past the bound: what it
    // sees of that letter is cut short, and none of it is kept.
    expect(cutToBound(`abe${ACUTE.repeat(40)}`, 4)).toBe('ab…');
  });

  it('reads a bounded part of a text of any size', () => {
    // A value a refusal was given may be megabytes, and the segmenter reads
    // whatever it is handed, so it is handed the bound and an allowance. Held
    // as how much text the segmenter is handed rather than as a time, as the
    // count of characters is.
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    try {
      expect(cutToBound('v'.repeat(4_000_000), 40)).toBe(`${'v'.repeat(39)}…`);
      const handed = segment.mock.calls.reduce((sum, [part]) => sum + part.length, 0);
      expect(handed).toBeLessThanOrEqual(39 + LONGEST_CHARACTER);
      // And at least the characters kept: a cut that segments some other way
      // would hand this nothing, and pass the bound above whatever it read.
      expect(handed, 'the cut saw none of the segmenting').toBeGreaterThanOrEqual(39);
    } finally {
      segment.mockRestore();
    }
  });

  it('is never longer than the bound at the character, whatever it cuts', () => {
    // A caller passes the room it has, so what comes back fits in it.
    const text = `${'word '.repeat(20)}and a 😀 or two`;
    for (let bound = 1; bound <= text.length; bound += 1) {
      expect(cutToBound(text, bound).length, String(bound)).toBeLessThanOrEqual(bound);
    }
  });
});

describe('a text cut at the last word that fits', () => {
  it('is the whole of a text already inside the bound', () => {
    expect(cutAtAWord('A short reason.', 200)).toBe('A short reason.');
  });

  it('cuts at the last space rather than mid-word', () => {
    // The cut falls two letters into a word. Were it to fall just after a
    // space, a cut at the bound itself would give the same answer.
    const reason = `${'word '.repeat(60)}tail`;

    const said = cutAtAWord(reason, 203);
    expect(said).toBe(`${'word '.repeat(39)}word…`);
  });

  it('keeps a word the cut ends exactly at', () => {
    // Nineteen code units are four words, and the next is a space: the last
    // word is whole, and taking the space before it dropped a word that fit.
    expect(cutAtAWord(`${'word '.repeat(10)}end`, 20)).toBe('word word word word…');
  });

  it('is never longer than the bound at a word, whatever it cuts', () => {
    // A caller passes the room it has, so what comes back fits in it.
    const text = `${'word '.repeat(20)}and a 😀 or two`;
    for (let bound = 1; bound <= text.length; bound += 1) {
      expect(cutAtAWord(text, bound).length, String(bound)).toBeLessThanOrEqual(bound);
    }
  });

  it('cuts a single word at a whole character, there being no boundary', () => {
    // The branch the quoting rule was guarded for and this one was not: one
    // word longer than the bound, with a character straddling the cut.
    expect(cutAtAWord(`${'a'.repeat(198)}😀b`, 200)).toBe(`${'a'.repeat(198)}…`);
    expect(cutAtAWord(`${'a'.repeat(198)}e${ACUTE}b`, 200)).toBe(`${'a'.repeat(198)}…`);
  });
});

describe('a text cut at the last word that fits in a number of characters', () => {
  it('is the whole of a text already inside the bound, counted in characters', () => {
    // A hundred and twenty emoji are two hundred and forty code units.
    expect(cutAtAWordToCharacters('😀'.repeat(120), 120)).toBe('😀'.repeat(120));
  });

  it('keeps as many characters as the bound allows, however many code units they are', () => {
    // Cut in code units, the same bound kept half as many.
    expect(cutAtAWordToCharacters('😀'.repeat(121), 120)).toBe(`${'😀'.repeat(119)}…`);
    expect(cutAtAWordToCharacters(`${'😀 '.repeat(60)}end`, 115)).toBe(`${'😀 '.repeat(56)}😀…`);
  });

  it('keeps a word the cut ends exactly at, and cuts back to the last space otherwise', () => {
    // Four characters and five code units a word: in code units, a bound of
    // twenty would end inside the fourth word.
    const word = `wo${ACUTE}rd`;
    const text = `${`${word} `.repeat(10)}end`;
    expect(cutAtAWordToCharacters(text, 20)).toBe(`${word} ${word} ${word} ${word}…`);
    expect(cutAtAWordToCharacters(text, 18)).toBe(`${word} ${word} ${word}…`);
  });

  it('counts a character longer than any real one for each allowance it fills', () => {
    // A letter under forty marks is forty-one code units and fills two
    // allowances, so a text of four characters and it counts as six.
    const text = `abc e${ACUTE.repeat(40)}`;
    expect(cutAtAWordToCharacters(text, 6)).toBe(text);
    expect(cutAtAWordToCharacters(text, 5)).toBe('abc…');
    const heavy = `e${ACUTE.repeat(40)}`;
    expect(cutAtAWordToCharacters(heavy.repeat(4), 4)).toBe(`${heavy}…`);
  });

  it('is never more characters than the bound, whatever it cuts', () => {
    const text = `${`wo${ACUTE}rd `.repeat(20)}and a 😀 or two and e${ACUTE.repeat(40)} last`;
    for (let bound = 1; bound <= 140; bound += 1) {
      expect(longerThan(cutAtAWordToCharacters(text, bound), bound), String(bound)).toBe(false);
    }
  });
});

describe("a reader's own text kept to a size", () => {
  it('is the whole of a text already inside the bound', () => {
    expect(wholeCharactersWithin('A note.', 4000)).toBe('A note.');
  });

  it('ends on a whole character, and adds nothing to say it was cut', () => {
    expect(wholeCharactersWithin(`${'x'.repeat(9)}😀y`, 10)).toBe('x'.repeat(9));
    expect(wholeCharactersWithin(`${'x'.repeat(8)}😀y`, 10)).toBe(`${'x'.repeat(8)}😀`);
  });
});

describe('the whole sentences at the start of a text', () => {
  it('takes all of them where they fit, and says so', () => {
    expect(sentencesWithin('One thing failed. Nothing else did.', 60)).toEqual({
      said: 'One thing failed. Nothing else did.',
      whole: true,
    });
  });

  it('stops at a sentence rather than at a word, and says something was left', () => {
    // Half a sentence about losing data is worse than none. The second sentence
    // straddles the bound rather than ending at it: were the sentences to end
    // exactly where a cut taken at the twentieth word would fall, the two rules
    // would give the same answer and this would prove neither.
    const notice = 'a b c d e f g h i j. k l m n o p q r s t u v w x. y z.';

    const taken = sentencesWithin(notice, 20);
    expect(taken.whole).toBe(false);
    expect(taken.said).toBe('a b c d e f g h i j.');
  });

  it('always says the first sentence, however long it is', () => {
    const one = `${'word '.repeat(200)}end.`;

    expect(sentencesWithin(one, 60).said).toBe(one.trim());
  });

  it('keeps the words after the last sentence ending, and counts them as left where they are', () => {
    // Matched as sentences that end, they were dropped, and the answer still
    // said it was the whole of the text.
    expect(sentencesWithin('Storage refused. Nothing was lost', 60)).toEqual({
      said: 'Storage refused. Nothing was lost',
      whole: true,
    });
    expect(sentencesWithin('Storage refused. Nothing was lost', 2)).toEqual({
      said: 'Storage refused.',
      whole: false,
    });
  });

  it('keeps the marks at the start of a text in its first sentence', () => {
    // Read by a pattern that needed a sentence to begin with something other
    // than a mark, the three dots were in no sentence and were not said.
    expect(sentencesWithin('... and then it stopped. Nothing was lost.', 60)).toEqual({
      said: '... and then it stopped. Nothing was lost.',
      whole: true,
    });
  });

  it('reads a long run of sentence marks once, however long it is', () => {
    // Read again from each mark, a run of two hundred thousand took longer
    // than the suite waits for a test. Held as how many characters are
    // looked at rather than as a time, which a machine's speed decides: a
    // run read once is looked at a bounded number of times a character,
    // whether a space or a letter follows it.
    const lookedAt = (text: string): number => {
      const charAt = vi.spyOn(String.prototype, 'charAt');
      try {
        sentencesWithin(text, 60);
        return charAt.mock.calls.length;
      } finally {
        charAt.mockRestore();
      }
    };
    for (const after of [' end.', 'end.']) {
      const looked = lookedAt(`${'.'.repeat(4_000)}${after}`);
      expect(looked).toBeLessThan(3 * 4_000);
      // And at least once each: a scan that reads the text some other way would
      // look at nothing through this, and would pass the bound above however
      // long it took.
      expect(looked, 'the count saw none of the scan').toBeGreaterThanOrEqual(4_000);
    }

    const marks = '.'.repeat(200_000);

    expect(sentencesWithin(`${marks} end.`, 60)).toEqual({ said: `${marks} end.`, whole: true });
  });

  it('ends no sentence at a full stop with no space after it', () => {
    // A version a notice quotes was said as two sentences, `v1. 2`.
    const notice = 'The layout says it is version "v1.2". Nothing was lost.';

    expect(sentencesWithin(notice, 60)).toEqual({ said: notice, whole: true });
  });

  it('reads a text with no sentence ending as one sentence', () => {
    expect(sentencesWithin('No full stop here', 60)).toEqual({
      said: 'No full stop here',
      whole: true,
    });
  });
});
